<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attempt;
use App\Models\AttemptAnswer;
use App\Models\Course;
use App\Models\Exam;
use App\Models\ExamPackage;
use App\Models\GradeScale;
use App\Models\Question;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class AdminController extends Controller
{
    public function importQuestions(Request $request)
    {
        $data = $request->validate([
            'file' => ['required', 'file', 'mimes:json,txt'],
            'course_id' => ['nullable', 'integer', 'exists:courses,id'],
            'course_name' => ['nullable', 'string', 'max:255'],
        ]);

        $payload = json_decode(file_get_contents($data['file']->getRealPath()), true);
        if (! is_array($payload)) {
            return response()->json(['message' => 'File JSON tidak valid.'], 422);
        }

        validator($payload, [
            'course_name' => ['nullable', 'string', 'max:255'],
            'exam_title' => ['required', 'string', 'max:255'],
            'duration_minutes' => ['required', 'integer', 'min:1', 'max:300'],
            'questions' => ['required', 'array', 'min:1'],
            'questions.*.week' => ['nullable', 'integer', 'min:1', 'max:16'],
            'questions.*.question_text' => ['required', 'string'],
            'questions.*.option_a' => ['required', 'string'],
            'questions.*.option_b' => ['required', 'string'],
            'questions.*.option_c' => ['required', 'string'],
            'questions.*.option_d' => ['required', 'string'],
            'questions.*.correct_option' => ['required', Rule::in(['a', 'b', 'c', 'd'])],
            'questions.*.explanation' => ['nullable', 'string'],
        ])->validate();

        $exam = DB::transaction(function () use ($data, $payload) {
            $course = $this->resolveCourse(
                $data['course_id'] ?? null,
                $data['course_name'] ?? $payload['course_name'] ?? $payload['mata_kuliah'] ?? null,
                $payload['exam_title']
            );

            $exam = Exam::updateOrCreate(
                [
                    'course_id' => $course?->id,
                    'title' => $payload['exam_title'],
                ],
                [
                    'duration_minutes' => $payload['duration_minutes'],
                    'is_active' => true,
                ]
            );

            foreach ($payload['questions'] as $question) {
                Question::updateOrCreate(
                    [
                        'exam_id' => $exam->id,
                        'question_text' => $question['question_text'],
                    ],
                    [
                        'week' => $question['week'] ?? null,
                        'option_a' => $question['option_a'],
                        'option_b' => $question['option_b'],
                        'option_c' => $question['option_c'],
                        'option_d' => $question['option_d'],
                        'correct_option' => $question['correct_option'],
                        'explanation' => $question['explanation'] ?? null,
                    ]
                );
            }

            ExamPackage::ensureDefaultPackagesForExam($exam);

            return $exam;
        });

        return response()->json([
            'message' => 'Import soal berhasil.',
            'exam' => $exam->load('course:id,name,slug'),
            'question_count' => $exam->questions()->count(),
        ]);
    }

    public function attempts()
    {
        return response()->json([
            'attempts' => Attempt::with(['user:id,nrp,name,email,class_name', 'exam:id,course_id,title', 'exam.course:id,name,slug', 'package:id,name,code'])
                ->latest('id')
                ->paginate(50),
        ]);
    }

    public function exams()
    {
        return response()->json([
            'exams' => Exam::with('course:id,name,slug')
                ->withCount(['questions', 'attempts'])
                ->orderBy('title')
                ->get()
                ->map(fn (Exam $exam) => $this->examPayload($exam))
                ->values(),
            'classes' => User::where('role', 'student')
                ->whereNotNull('class_name')
                ->distinct()
                ->orderBy('class_name')
                ->pluck('class_name')
                ->values(),
        ]);
    }

    public function updateExamSettings(Request $request, Exam $exam)
    {
        $data = $request->validate([
            'duration_minutes' => ['required', 'integer', 'min:1', 'max:300'],
            'is_active' => ['required', 'boolean'],
            'opens_at' => ['nullable', 'date'],
            'closes_at' => ['nullable', 'date', 'after_or_equal:opens_at'],
        ]);

        $exam->update($data);

        return response()->json([
            'message' => $exam->is_active ? 'Ujian dibuka.' : 'Ujian ditutup.',
            'exam' => $this->examPayload($exam->fresh(['course'])->loadCount(['questions', 'attempts'])),
        ]);
    }

    public function resetExamAttempts(Request $request, Exam $exam)
    {
        $data = $request->validate([
            'class_name' => ['nullable', 'string', 'max:100'],
        ]);

        $query = Attempt::where('exam_id', $exam->id)
            ->when($data['class_name'] ?? null, fn ($query, $className) => $query->whereHas('user', fn ($user) => $user->where('class_name', $className)));

        $deleted = $query->count();
        $query->delete();

        return response()->json([
            'message' => $deleted.' attempt ujian berhasil direset.',
            'deleted_attempts' => $deleted,
            'exam' => $this->examPayload($exam->fresh(['course'])->loadCount(['questions', 'attempts'])),
        ]);
    }

    public function report(Request $request)
    {
        $filters = $request->validate([
            'course_id' => ['nullable', 'integer', 'exists:courses,id'],
            'exam_id' => ['nullable', 'integer', 'exists:exams,id'],
            'class_name' => ['nullable', 'string', 'max:100'],
        ]);

        $attemptQuery = Attempt::with(['user:id,nrp,name,email,class_name', 'exam:id,course_id,title', 'exam.course:id,name,slug', 'package:id,name,code'])
            ->when($filters['exam_id'] ?? null, fn ($query, $examId) => $query->where('exam_id', $examId))
            ->when($filters['course_id'] ?? null, fn ($query, $courseId) => $query->whereHas('exam', fn ($exam) => $exam->where('course_id', $courseId)))
            ->when($filters['class_name'] ?? null, fn ($query, $className) => $query->whereHas('user', fn ($user) => $user->where('class_name', $className)))
            ->latest('id');

        $attempts = $attemptQuery->get();
        $scoredAttempts = $attempts->filter(fn (Attempt $attempt) => $attempt->submitted_at !== null);
        $eligibleStudents = User::where('role', 'student')
            ->when($filters['class_name'] ?? null, fn ($query, $className) => $query->where('class_name', $className))
            ->count();

        $reportExam = $this->reportExam($filters);
        $questionAnalysis = $reportExam
            ? $this->questionAnalysis($reportExam, $scoredAttempts->where('exam_id', $reportExam->id)->pluck('id')->all())
            : [];

        // Mahasiswa yang belum mengerjakan: tidak punya attempt sesuai filter aktif
        // (per-ujian jika exam dipilih, per-mata-kuliah jika course dipilih, atau global).
        $attemptedUserIds = $attempts->pluck('user_id')->unique()->all();
        $notAttempted = User::where('role', 'student')
            ->when($filters['class_name'] ?? null, fn ($query, $className) => $query->where('class_name', $className))
            ->whereNotIn('id', $attemptedUserIds)
            ->orderBy('class_name')
            ->orderBy('name')
            ->get(['id', 'nrp', 'name', 'class_name', 'first_login_at']);

        return response()->json([
            'filters' => $filters,
            'meta' => [
                'courses' => Course::orderBy('name')->get(['id', 'name', 'slug']),
                'exams' => Exam::with('course:id,name,slug')->orderBy('title')->get(['id', 'course_id', 'title']),
                'classes' => User::where('role', 'student')
                    ->whereNotNull('class_name')
                    ->distinct()
                    ->orderBy('class_name')
                    ->pluck('class_name')
                    ->values(),
            ],
            'summary' => [
                'eligible_students' => $eligibleStudents,
                'attempts_total' => $attempts->count(),
                'scored_total' => $scoredAttempts->count(),
                'in_progress_total' => $attempts->where('status', 'in_progress')->count(),
                'submitted_total' => $attempts->where('status', 'submitted')->count(),
                'expired_total' => $attempts->where('status', 'expired')->count(),
                'average_percentage' => round((float) ($scoredAttempts->avg('percentage') ?? 0), 2),
                'highest_percentage' => round((float) ($scoredAttempts->max('percentage') ?? 0), 2),
                'lowest_percentage' => round((float) ($scoredAttempts->min('percentage') ?? 0), 2),
                'completion_rate' => $eligibleStudents > 0
                    ? round(($scoredAttempts->count() / $eligibleStudents) * 100, 2)
                    : 0,
            ],
            'grade_distribution' => $this->distribution($scoredAttempts, 'letter_grade'),
            'package_distribution' => $attempts
                ->groupBy(fn (Attempt $attempt) => $attempt->package?->code ?? '-')
                ->map(fn ($items, $key) => ['label' => $key, 'total' => $items->count()])
                ->values(),
            'student_results' => $attempts->map(fn (Attempt $attempt) => [
                'id' => $attempt->id,
                'student' => [
                    'nrp' => $attempt->user?->nrp,
                    'name' => $attempt->user?->name,
                    'class_name' => $attempt->user?->class_name,
                ],
                'course' => $attempt->exam?->course?->name,
                'exam' => $attempt->exam?->title,
                'package' => $attempt->package?->code,
                'shuffle_pattern' => $attempt->shuffle_pattern,
                'status' => $attempt->status,
                'score' => $attempt->score,
                'total_questions' => $attempt->total_questions,
                'percentage' => $attempt->percentage,
                'letter_grade' => $attempt->letter_grade,
                'started_at' => $attempt->started_at,
                'submitted_at' => $attempt->submitted_at,
            ])->values(),
            'question_analysis_exam' => $reportExam?->load('course:id,name,slug'),
            'question_analysis' => $questionAnalysis,
            'not_attempted' => $notAttempted->map(fn (User $student) => [
                'id' => $student->id,
                'nrp' => $student->nrp,
                'name' => $student->name,
                'class_name' => $student->class_name,
                'first_login_at' => $student->first_login_at,
                'has_logged_in' => $student->first_login_at !== null,
            ])->values(),
        ]);
    }

    public function courses()
    {
        return response()->json([
            'courses' => Course::withCount('exams')
                ->with(['gradeScales' => fn ($query) => $query->orderBy('sort_order')])
                ->orderBy('name')
                ->get(),
        ]);
    }

    public function storeCourse(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', 'unique:courses,name'],
            'slug' => ['nullable', 'string', 'max:255', 'unique:courses,slug'],
            'is_active' => ['nullable', 'boolean'],
        ]);

        $course = Course::create([
            'name' => $data['name'],
            'slug' => $data['slug'] ?? Str::slug($data['name']),
            'is_active' => $data['is_active'] ?? true,
        ]);
        GradeScale::ensureDefaultsForCourse($course);

        return response()->json(['course' => $course], 201);
    }

    public function gradeScales(Course $course)
    {
        GradeScale::ensureDefaultsForCourse($course);

        return response()->json([
            'course' => $course,
            'grade_scales' => $course->gradeScales()->orderBy('sort_order')->get(),
        ]);
    }

    public function packages(Exam $exam)
    {
        return response()->json([
            'exam' => $exam->load('course:id,name,slug'),
            'packages' => $exam->packages()
                ->withCount('questions')
                ->orderBy('code')
                ->get(),
            'bank_question_count' => $exam->questions()->count(),
        ]);
    }

    public function questions(Exam $exam)
    {
        return response()->json([
            'exam' => $this->examPayload($exam->load('course:id,name,slug')->loadCount(['questions', 'attempts'])),
            'questions' => $exam->questions()
                ->orderBy('week')
                ->orderBy('id')
                ->get()
                ->map(fn (Question $question) => $this->questionPayload($question))
                ->values(),
        ]);
    }

    public function storeQuestion(Request $request, Exam $exam)
    {
        $data = $this->questionData($request);

        $question = DB::transaction(function () use ($exam, $data) {
            $question = $exam->questions()->create($data);
            $this->syncExamPackages($exam);

            return $question;
        });

        return response()->json([
            'message' => 'Soal berhasil ditambahkan.',
            'question' => $this->questionPayload($question),
            'exam' => $this->examPayload($exam->fresh(['course'])->loadCount(['questions', 'attempts'])),
        ], 201);
    }

    public function updateQuestion(Request $request, Exam $exam, Question $question)
    {
        $this->ensureQuestionBelongsToExam($exam, $question);

        $data = $this->questionData($request);
        DB::transaction(function () use ($exam, $question, $data) {
            $question->update($data);
            $this->syncExamPackages($exam);
        });

        return response()->json([
            'message' => 'Soal berhasil diperbarui.',
            'question' => $this->questionPayload($question->fresh()),
            'exam' => $this->examPayload($exam->fresh(['course'])->loadCount(['questions', 'attempts'])),
        ]);
    }

    public function destroyQuestion(Exam $exam, Question $question)
    {
        $this->ensureQuestionBelongsToExam($exam, $question);

        if ($question->attemptAnswers()->exists()) {
            return response()->json([
                'message' => 'Soal sudah dipakai dalam attempt mahasiswa. Reset ujian terlebih dahulu sebelum menghapus soal ini.',
            ], 422);
        }

        DB::transaction(function () use ($exam, $question) {
            $question->delete();
            $this->syncExamPackages($exam);
        });

        return response()->json([
            'message' => 'Soal berhasil dihapus.',
            'exam' => $this->examPayload($exam->fresh(['course'])->loadCount(['questions', 'attempts'])),
        ]);
    }

    public function storePackage(Request $request, Exam $exam)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'code' => ['required', 'string', 'max:20', Rule::unique('exam_packages', 'code')->where('exam_id', $exam->id)],
            'question_ids' => ['nullable', 'array'],
            'question_ids.*' => ['integer', Rule::exists('questions', 'id')->where('exam_id', $exam->id)],
        ]);

        $package = ExamPackage::create([
            'exam_id' => $exam->id,
            'name' => $data['name'],
            'code' => strtoupper($data['code']),
            'is_active' => true,
        ]);

        if (! empty($data['question_ids'])) {
            $package->questions()->sync(collect($data['question_ids'])->values()->mapWithKeys(fn ($questionId, $index) => [
                $questionId => ['sort_order' => $index + 1],
            ])->all());
        } else {
            ExamPackage::syncPackageWithExamBank($package, $exam);
        }

        return response()->json([
            'package' => $package->loadCount('questions'),
        ], 201);
    }

    private function questionData(Request $request): array
    {
        return $request->validate([
            'week' => ['nullable', 'integer', 'min:1', 'max:16'],
            'question_text' => ['required', 'string'],
            'option_a' => ['required', 'string'],
            'option_b' => ['required', 'string'],
            'option_c' => ['required', 'string'],
            'option_d' => ['required', 'string'],
            'correct_option' => ['required', Rule::in(['a', 'b', 'c', 'd'])],
            'explanation' => ['nullable', 'string'],
        ]);
    }

    private function questionPayload(Question $question): array
    {
        return [
            'id' => $question->id,
            'exam_id' => $question->exam_id,
            'week' => $question->week,
            'question_text' => $question->question_text,
            'option_a' => $question->option_a,
            'option_b' => $question->option_b,
            'option_c' => $question->option_c,
            'option_d' => $question->option_d,
            'correct_option' => $question->correct_option,
            'explanation' => $question->explanation,
        ];
    }

    private function ensureQuestionBelongsToExam(Exam $exam, Question $question): void
    {
        if ($question->exam_id !== $exam->id) {
            abort(404);
        }
    }

    private function syncExamPackages(Exam $exam): void
    {
        $exam->packages()->get()->each(fn (ExamPackage $package) => ExamPackage::syncPackageWithExamBank($package, $exam));
    }

    private function examPayload(Exam $exam): array
    {
        return [
            'id' => $exam->id,
            'course_id' => $exam->course_id,
            'course' => $exam->course,
            'title' => $exam->title,
            'duration_minutes' => $exam->duration_minutes,
            'is_active' => $exam->is_active,
            'opens_at' => $exam->opens_at,
            'closes_at' => $exam->closes_at,
            'is_open_now' => $exam->isOpenNow(),
            'questions_count' => $exam->questions_count ?? $exam->questions()->count(),
            'attempts_count' => $exam->attempts_count ?? $exam->attempts()->count(),
        ];
    }

    private function reportExam(array $filters): ?Exam
    {
        if (! empty($filters['exam_id'])) {
            return Exam::find($filters['exam_id']);
        }

        if (! empty($filters['course_id'])) {
            return Exam::withCount('questions')
                ->where('course_id', $filters['course_id'])
                ->orderByDesc('questions_count')
                ->latest('id')
                ->first();
        }

        return null;
    }

    private function questionAnalysis(Exam $exam, array $attemptIds): array
    {
        if (empty($attemptIds)) {
            return $exam->questions()
                ->orderBy('week')
                ->orderBy('id')
                ->get(['id', 'week', 'question_text'])
                ->map(fn (Question $question, int $index) => [
                    'number' => $index + 1,
                    'question_id' => $question->id,
                    'week' => $question->week,
                    'question_text' => $question->question_text,
                    'answered_total' => 0,
                    'correct_total' => 0,
                    'wrong_total' => 0,
                    'unanswered_total' => 0,
                    'correct_rate' => 0,
                ])
                ->all();
        }

        $answers = AttemptAnswer::whereIn('attempt_id', $attemptIds)
            ->whereIn('question_id', $exam->questions()->pluck('id'))
            ->get()
            ->groupBy('question_id');

        $participantCount = count($attemptIds);

        return $exam->questions()
            ->orderBy('week')
            ->orderBy('id')
            ->get(['id', 'week', 'question_text'])
            ->map(function (Question $question, int $index) use ($answers, $participantCount) {
                $items = $answers->get($question->id, collect());
                $answered = $items->whereNotNull('selected_option')->count();
                $correct = $items->where('is_correct', true)->count();
                $wrong = $items->filter(fn (AttemptAnswer $answer) => $answer->selected_option !== null && $answer->is_correct === false)->count();
                $unanswered = max(0, $participantCount - $answered);

                return [
                    'number' => $index + 1,
                    'question_id' => $question->id,
                    'week' => $question->week,
                    'question_text' => $question->question_text,
                    'answered_total' => $answered,
                    'correct_total' => $correct,
                    'wrong_total' => $wrong,
                    'unanswered_total' => $unanswered,
                    'correct_rate' => $participantCount > 0 ? round(($correct / $participantCount) * 100, 2) : 0,
                ];
            })
            ->sortBy('correct_rate')
            ->values()
            ->all();
    }

    private function distribution($items, string $field)
    {
        return $items
            ->groupBy(fn (Attempt $attempt) => $attempt->{$field} ?: '-')
            ->map(fn ($group, $label) => ['label' => $label, 'total' => $group->count()])
            ->sortBy('label')
            ->values();
    }

    private function resolveCourse(?int $courseId, ?string $courseName, string $examTitle): ?Course
    {
        if ($courseId) {
            return Course::findOrFail($courseId);
        }

        $name = $courseName ?: (str_contains(strtolower($examTitle), 'k3l') ? 'K3L' : null);
        if (! $name) {
            return null;
        }

        $course = Course::firstOrCreate(
            ['slug' => Str::slug($name)],
            ['name' => $name, 'is_active' => true]
        );
        GradeScale::ensureDefaultsForCourse($course);

        return $course;
    }
}
