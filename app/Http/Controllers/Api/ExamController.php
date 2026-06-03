<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attempt;
use App\Models\AttemptAnswer;
use App\Models\Course;
use App\Models\Exam;
use App\Models\ExamPackage;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ExamController extends Controller
{
    private const TRUE_FALSE_ATTEMPT_LIMIT = 10;

    public function active(Request $request)
    {
        $className = $request->user()->class_name;
        $query = Exam::with('course:id,name,slug')
            ->withCount(['questions' => fn ($questions) => $this->scopeQuestionsForClass($questions, $className)])
            ->where('is_active', true)
            ->where(fn ($exams) => $exams
                ->whereNull('class_name')
                ->when($className, fn ($exams) => $exams->orWhere('class_name', $className)))
            ->where(fn ($window) => $window->whereNull('opens_at')->orWhere('opens_at', '<=', now()))
            ->where(fn ($window) => $window->whereNull('closes_at')->orWhere('closes_at', '>=', now()));

        $allowed = $this->allowedCourseSlugs($className);
        if ($allowed !== null) {
            $query->whereHas('course', fn ($course) => $course->whereIn('slug', $allowed));
        }

        if ($request->filled('course_id')) {
            $query->where('course_id', $request->integer('course_id'));
        }

        if ($request->filled('course_slug')) {
            $query->whereHas('course', fn ($course) => $course->where('slug', $request->string('course_slug')->toString()));
        }

        if ($request->filled('exam_id')) {
            $query->where('id', $request->integer('exam_id'));
        }

        $exams = $query->orderBy('title')->get();

        if ($exams->isEmpty()) {
            return response()->json(['message' => 'Belum ada ujian aktif.'], 404);
        }

        $attempts = Attempt::whereIn('exam_id', $exams->pluck('id'))
            ->where('user_id', $request->user()->id)
            ->get()
            ->keyBy('exam_id');

        $examPayload = fn (Exam $exam) => [
            'id' => $exam->id,
            'course' => $exam->course,
            'title' => $exam->title,
            'duration_minutes' => $exam->duration_minutes,
            'opens_at' => $exam->opens_at,
            'closes_at' => $exam->closes_at,
            'question_count' => $exam->questions_count,
            'package_count' => $exam->packages()->where('is_active', true)->count(),
            'attempt' => $attempts->get($exam->id),
        ];

        $examList = $exams->map($examPayload)->values();
        $selected = $examList->first();

        return response()->json([
            'exams' => $examList,
            'exam' => collect($selected)->except('attempt')->all(),
            'attempt' => $selected['attempt'] ?? null,
        ]);
    }

    public function start(Request $request, Exam $exam)
    {
        $className = $request->user()->class_name;
        $allowed = $this->allowedCourseSlugs($className);
        if ($allowed !== null && ! in_array($exam->loadMissing('course')->course?->slug, $allowed, true)) {
            return response()->json(['message' => 'Ujian ini tidak tersedia untuk kelas Anda.'], 403);
        }

        if ($exam->class_name && $exam->class_name !== $className) {
            return response()->json(['message' => 'Ujian ini khusus untuk kelas lain.'], 403);
        }

        if (! $exam->is_active) {
            return response()->json(['message' => 'Ujian ditutup oleh admin.'], 422);
        }

        if ($exam->opens_at && now()->lessThan($exam->opens_at)) {
            return response()->json(['message' => 'Masa ujian belum dibuka.'], 422);
        }

        if ($exam->closes_at && now()->greaterThan($exam->closes_at)) {
            return response()->json(['message' => 'Masa ujian sudah berakhir.'], 422);
        }

        $package = $this->packageForStudent($exam, $request->user()->id);
        $questions = $package
            ? $this->scopeQuestionsForClass($package->questions(), $className)->get(['questions.id', 'questions.question_type'])
            : $this->scopeQuestionsForClass($exam->questions(), $className)->orderBy('id')->get(['id', 'question_type']);

        if ($questions->isEmpty()) {
            return response()->json(['message' => 'Soal belum diimport.'], 422);
        }

        $existing = Attempt::where('exam_id', $exam->id)
            ->where('user_id', $request->user()->id)
            ->first();

        if ($existing) {
            return response()->json([
                'message' => 'Attempt sudah pernah dibuat untuk ujian ini.',
                'attempt' => $existing,
            ], 409);
        }

        $attempt = DB::transaction(function () use ($request, $exam, $package, $questions) {
            $startedAt = now();
            $shufflePattern = $this->shufflePatternForStudent($exam->id, $request->user()->id);
            $orderedQuestions = $this->orderedQuestionIdsForAttempt($questions, $exam->id, $request->user()->id, $package?->id, $shufflePattern);

            $attempt = Attempt::create([
                'exam_id' => $exam->id,
                'exam_package_id' => $package?->id,
                'shuffle_pattern' => $shufflePattern,
                'user_id' => $request->user()->id,
                'started_at' => $startedAt,
                'ends_at' => $startedAt->copy()->addMinutes($exam->duration_minutes),
                'status' => 'in_progress',
                'score' => 0,
                'total_questions' => count($orderedQuestions),
            ]);

            AttemptAnswer::insert(collect($orderedQuestions)->values()->map(fn ($questionId, $index) => [
                'attempt_id' => $attempt->id,
                'question_id' => $questionId,
                'display_order' => $index + 1,
                'created_at' => now(),
                'updated_at' => now(),
            ])->all());

            return $attempt;
        });

        return response()->json(['attempt' => $attempt], 201);
    }

    public function courses(Request $request)
    {
        $allowed = $this->allowedCourseSlugs($request->user()->class_name);

        return response()->json([
            'courses' => Course::withCount(['exams' => fn ($query) => $query
                ->where('is_active', true)
                ->where(fn ($exams) => $exams
                    ->whereNull('class_name')
                    ->when($request->user()->class_name, fn ($exams, $className) => $exams->orWhere('class_name', $className)))
                ->where(fn ($window) => $window->whereNull('opens_at')->orWhere('opens_at', '<=', now()))
                ->where(fn ($window) => $window->whereNull('closes_at')->orWhere('closes_at', '>=', now()))])
                ->where('is_active', true)
                ->when($allowed !== null, fn ($query) => $query->whereIn('slug', $allowed))
                ->orderBy('name')
                ->get(),
        ]);
    }

    /**
     * Daftar slug course yang boleh diakses kelas ini, atau null bila tak
     * dibatasi (kelas tidak terdaftar di config/class_courses.php).
     */
    private function allowedCourseSlugs(?string $className): ?array
    {
        if ($className === null) {
            return null;
        }

        return config('class_courses')[$className] ?? null;
    }

    private function scopeQuestionsForClass($query, ?string $className)
    {
        return $query->where(fn ($questions) => $questions
            ->whereNull('questions.class_name')
            ->when($className, fn ($questions) => $questions->orWhere('questions.class_name', $className)));
    }

    private function packageForStudent(Exam $exam, int $userId): ?ExamPackage
    {
        $packages = $exam->packages()
            ->where('is_active', true)
            ->withCount('questions')
            ->get()
            ->filter(fn (ExamPackage $package) => $package->questions_count > 0)
            ->values();

        if ($packages->isEmpty()) {
            return null;
        }

        return $packages[($userId - 1) % $packages->count()];
    }

    private function shufflePatternForStudent(int $examId, int $userId): int
    {
        return (abs(crc32("exam:{$examId}:user:{$userId}")) % 10) + 1;
    }

    /**
     * Deterministic per-attempt shuffle: same student keeps the same order after refresh,
     * different students can receive different package/order patterns.
     */
    private function deterministicShuffle(array $questionIds, int $examId, int $userId, ?int $packageId, int $pattern): array
    {
        usort($questionIds, function (int $left, int $right) use ($examId, $userId, $packageId, $pattern) {
            $leftHash = crc32("{$examId}:{$packageId}:{$userId}:{$pattern}:{$left}");
            $rightHash = crc32("{$examId}:{$packageId}:{$userId}:{$pattern}:{$right}");

            return $leftHash <=> $rightHash;
        });

        return $questionIds;
    }

    private function orderedQuestionIdsForAttempt($questions, int $examId, int $userId, ?int $packageId, int $pattern): array
    {
        $multipleChoiceIds = $questions
            ->filter(fn ($question) => ($question->question_type ?? 'multiple_choice') !== 'true_false')
            ->pluck('id')
            ->all();
        $trueFalseIds = $questions
            ->filter(fn ($question) => ($question->question_type ?? 'multiple_choice') === 'true_false')
            ->pluck('id')
            ->all();

        $orderedMultipleChoice = $this->deterministicShuffle($multipleChoiceIds, $examId, $userId, $packageId, $pattern);
        $orderedTrueFalse = array_slice(
            $this->deterministicShuffle($trueFalseIds, $examId, $userId, $packageId, $pattern + 10),
            0,
            self::TRUE_FALSE_ATTEMPT_LIMIT
        );

        return [...$orderedMultipleChoice, ...$orderedTrueFalse];
    }
}
