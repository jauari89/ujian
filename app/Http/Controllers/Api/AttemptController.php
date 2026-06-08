<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attempt;
use App\Models\AttemptAnswer;
use App\Models\GradeScale;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class AttemptController extends Controller
{
    private const TRUE_FALSE_ATTEMPT_LIMIT = 10;
    private const MAX_PROCTOR_EVENTS = 100;

    public function show(Request $request, Attempt $attempt)
    {
        $this->authorizeAttempt($request, $attempt);
        $this->expireIfNeeded($attempt);
        $this->appendMissingTrueFalseAnswers($attempt);

        $attempt->load([
            'exam:id,course_id,title,duration_minutes',
            'exam.course:id,name,slug',
            'package:id,name,code',
            'answers.question:id,exam_id,week,question_type,level,question_text,image_url,option_a,option_b,option_c,option_d',
        ]);

        $this->applyTrueFalseOptionShuffle($attempt);

        return response()->json(['attempt' => $attempt]);
    }

    public function answer(Request $request, Attempt $attempt)
    {
        $this->authorizeAttempt($request, $attempt);
        $this->expireIfNeeded($attempt);

        $data = $request->validate([
            'question_id' => ['required', 'integer', Rule::exists('questions', 'id')->where('exam_id', $attempt->exam_id)],
        ]);

        if ($attempt->status !== 'in_progress' || now()->greaterThan($attempt->ends_at)) {
            $this->expireIfNeeded($attempt, true);

            return response()->json(['message' => 'Waktu ujian sudah habis. Jawaban tidak bisa diubah.'], 422);
        }

        $answer = AttemptAnswer::where('attempt_id', $attempt->id)
            ->where('question_id', $data['question_id'])
            ->with('question')
            ->firstOrFail();

        $questionType = $answer->question->question_type ?? 'multiple_choice';
        if ($questionType === 'true_false') {
            $tfData = $request->validate([
                'selected_options' => ['required', 'array'],
                'selected_options.a' => ['nullable', 'boolean'],
                'selected_options.b' => ['nullable', 'boolean'],
                'selected_options.c' => ['nullable', 'boolean'],
                'selected_options.d' => ['nullable', 'boolean'],
            ]);

            $answer->update([
                'selected_option' => null,
                'selected_options' => $this->normalizeBooleanOptions($tfData['selected_options']),
                'essay_answer' => null,
                'answered_at' => now(),
            ]);
        } elseif ($questionType === 'hots') {
            $essayData = $request->validate([
                'essay_answer' => ['required', 'string', 'max:10000'],
            ]);

            $answer->update([
                'selected_option' => null,
                'selected_options' => null,
                'essay_answer' => $essayData['essay_answer'],
                'answered_at' => now(),
            ]);
        } else {
            $choiceData = $request->validate([
                'selected_option' => ['required', Rule::in(['a', 'b', 'c', 'd'])],
            ]);

            $answer->update([
                'selected_option' => $choiceData['selected_option'],
                'selected_options' => null,
                'essay_answer' => null,
                'answered_at' => now(),
            ]);
        }

        return response()->json(['answer' => $answer]);
    }

    public function uploadFile(Request $request, Attempt $attempt)
    {
        $this->authorizeAttempt($request, $attempt);
        $this->expireIfNeeded($attempt);

        if ($attempt->status !== 'in_progress' || now()->greaterThan($attempt->ends_at)) {
            $this->expireIfNeeded($attempt, true);

            return response()->json(['message' => 'Masa pengumpulan tugas sudah berakhir.'], 422);
        }

        $data = $request->validate([
            'question_id' => ['required', 'integer', Rule::exists('questions', 'id')->where('exam_id', $attempt->exam_id)],
            'file' => ['required', 'file', 'mimetypes:application/pdf', 'mimes:pdf', 'max:10240'],
        ], [], ['file' => 'berkas tugas']);

        $answer = AttemptAnswer::where('attempt_id', $attempt->id)
            ->where('question_id', $data['question_id'])
            ->with('question')
            ->firstOrFail();

        if (($answer->question->question_type ?? 'multiple_choice') !== 'file_upload') {
            return response()->json(['message' => 'Soal ini bukan tipe upload tugas.'], 422);
        }

        if ($answer->file_path) {
            Storage::disk('local')->delete($answer->file_path);
        }

        $file = $request->file('file');
        $path = $file->store("tugas/{$attempt->id}", 'local');

        $answer->update([
            'selected_option' => null,
            'selected_options' => null,
            'essay_answer' => null,
            'file_path' => $path,
            'file_original_name' => $file->getClientOriginalName(),
            'file_size' => $file->getSize(),
            'answered_at' => now(),
        ]);

        return response()->json(['answer' => $answer]);
    }

    public function proctorEvent(Request $request, Attempt $attempt)
    {
        $this->authorizeAttempt($request, $attempt);

        if ($attempt->status !== 'in_progress') {
            return response()->json(['attempt' => $attempt]);
        }

        $data = $request->validate([
            'type' => ['required', Rule::in(['camera_absence_warning', 'camera_absence_violation', 'tab_switch_warning'])],
            'message' => ['nullable', 'string', 'max:255'],
            'absence_seconds' => ['nullable', 'integer', 'min:0', 'max:3600'],
            'tab_switch_count' => ['nullable', 'integer', 'min:1', 'max:10000'],
            'warning_count' => ['required', 'integer', 'min:0', 'max:255'],
        ]);

        $events = collect($attempt->proctor_events ?? [])
            ->push([
                'type' => $data['type'],
                'message' => $data['message'] ?? null,
                'absence_seconds' => $data['absence_seconds'] ?? null,
                'tab_switch_count' => $data['tab_switch_count'] ?? null,
                'warning_count' => $data['warning_count'],
                'recorded_at' => now()->toISOString(),
            ])
            ->take(-self::MAX_PROCTOR_EVENTS)
            ->values()
            ->all();

        $attempt->update([
            'proctor_warnings' => max((int) $attempt->proctor_warnings, (int) $data['warning_count']),
            'proctor_violation' => $attempt->proctor_violation || $data['type'] === 'camera_absence_violation',
            'proctor_events' => $events,
        ]);

        return response()->json(['attempt' => $attempt->fresh()]);
    }

    public function submit(Request $request, Attempt $attempt)
    {
        $this->authorizeAttempt($request, $attempt);

        $attempt = DB::transaction(fn () => $this->scoreAttempt($attempt));

        return response()->json(['attempt' => $attempt]);
    }

    public function result(Request $request, Attempt $attempt)
    {
        $this->authorizeAttempt($request, $attempt);

        if (
            ($attempt->status === 'in_progress' && now()->greaterThan($attempt->ends_at))
            || ($attempt->status === 'expired' && ! $attempt->submitted_at)
        ) {
            $attempt = $this->scoreAttempt($attempt);
        }

        if ($attempt->status === 'in_progress') {
            return response()->json(['message' => 'Ujian belum disubmit.'], 422);
        }

        $attempt->load([
            'exam:id,course_id,title,duration_minutes',
            'exam.course:id,name,slug',
            'package:id,name,code',
            'answers.question:id,exam_id,week,question_type,level,question_text,image_url,option_a,option_b,option_c,option_d',
        ]);

        $this->applyTrueFalseOptionShuffle($attempt);

        return response()->json([
            'attempt' => $attempt,
            'percentage' => $attempt->percentage,
            'grade' => [
                'letter' => $attempt->letter_grade,
                'numeric' => $attempt->numeric_grade,
                'category' => $attempt->grade_category,
            ],
        ]);
    }

    private function authorizeAttempt(Request $request, Attempt $attempt): void
    {
        if ($request->user()->role !== 'admin' && $attempt->user_id !== $request->user()->id) {
            abort(403, 'Forbidden');
        }
    }

    private function expireIfNeeded(Attempt $attempt, bool $forceScore = false): void
    {
        if ($attempt->status === 'in_progress' && now()->greaterThan($attempt->ends_at)) {
            if ($forceScore) {
                $this->scoreAttempt($attempt);

                return;
            }

            $attempt->update(['status' => 'expired']);
            $attempt->refresh();
        }
    }

    private function appendMissingTrueFalseAnswers(Attempt $attempt): void
    {
        if ($attempt->status !== 'in_progress') {
            return;
        }

        $existingTrueFalseCount = $attempt->answers()
            ->whereHas('question', fn ($question) => $question->where('question_type', 'true_false'))
            ->count();

        if ($existingTrueFalseCount >= self::TRUE_FALSE_ATTEMPT_LIMIT) {
            return;
        }

        $existingQuestionIds = $attempt->answers()->pluck('question_id')->all();
        $className = $attempt->loadMissing('user')->user?->class_name;
        $missingQuestions = $attempt->exam->questions()
            ->where('question_type', 'true_false')
            ->where(fn ($questions) => $questions
                ->whereNull('class_name')
                ->when($className, fn ($questions) => $questions->orWhere('class_name', $className)))
            ->whereNotIn('id', $existingQuestionIds)
            ->orderBy('week')
            ->orderBy('id')
            ->limit(self::TRUE_FALSE_ATTEMPT_LIMIT - $existingTrueFalseCount)
            ->get(['id']);

        if ($missingQuestions->isEmpty()) {
            return;
        }

        $nextOrder = (int) $attempt->answers()->max('display_order');
        AttemptAnswer::insert($missingQuestions->values()->map(fn ($question, int $index) => [
            'attempt_id' => $attempt->id,
            'question_id' => $question->id,
            'display_order' => $nextOrder + $index + 1,
            'created_at' => now(),
            'updated_at' => now(),
        ])->all());

        $attempt->update(['total_questions' => $attempt->answers()->count()]);
        $attempt->refresh();
    }

    private function scoreAttempt(Attempt $attempt): Attempt
    {
        $attempt->load('answers.question', 'exam.course');

        // Nilai gabungan: tiap soal = 1 poin. PG/TF otomatis (benar=1/salah=0),
        // HOTS/tugas dinilai manual (manual_score/100 poin). Yang belum dinilai
        // berkontribusi 0 (pending) sampai dosen mengoreksi.
        foreach ($attempt->answers as $answer) {
            $answer->update(['is_correct' => $this->answerIsCorrect($attempt, $answer)]);
        }

        [$earned, $total, $percentage] = $attempt->combinedScore();
        $grade = $this->gradeFor($attempt, $percentage);

        $attempt->update([
            'submitted_at' => $attempt->submitted_at ?? now(),
            'status' => now()->greaterThan($attempt->ends_at) ? 'expired' : 'submitted',
            'score' => (int) round($earned),
            'percentage' => $percentage,
            'letter_grade' => $grade?->letter_grade,
            'numeric_grade' => $grade?->numeric_grade,
            'grade_category' => $grade?->category,
            'total_questions' => $total,
        ]);

        return $attempt->refresh();
    }

    private function gradeFor(Attempt $attempt, float $percentage): ?GradeScale
    {
        $courseId = $attempt->exam?->course_id;
        if (! $courseId) {
            return null;
        }

        if ($attempt->exam?->course && ! $attempt->exam->course->gradeScales()->exists()) {
            GradeScale::ensureDefaultsForCourse($attempt->exam->course);
        }

        return GradeScale::where('course_id', $courseId)
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->get()
            ->first(fn (GradeScale $scale) => $scale->contains($percentage));
    }

    private function answerIsCorrect(Attempt $attempt, AttemptAnswer $answer): ?bool
    {
        $questionType = $answer->question->question_type ?? 'multiple_choice';
        if ($questionType === 'hots' || $questionType === 'file_upload') {
            return null;
        }

        if ($questionType === 'true_false') {
            $selected = $this->normalizeBooleanOptions($answer->selected_options ?? []);
            // Jawaban tersimpan pada posisi tampil (a/b/c/d) yang diacak per-attempt,
            // jadi kunci kanonik diputar ke urutan tampil sebelum dibandingkan.
            $correct = $this->displayOrderedCorrectOptions($attempt, $answer->question);

            foreach (['a', 'b', 'c', 'd'] as $key) {
                if ($selected[$key] === null || $selected[$key] !== $correct[$key]) {
                    return false;
                }
            }

            return true;
        }

        return $answer->selected_option !== null
            && $answer->selected_option === $answer->question->correct_option;
    }

    private function normalizeBooleanOptions(array $options): array
    {
        return collect(['a', 'b', 'c', 'd'])
            ->mapWithKeys(fn (string $key) => [
                $key => array_key_exists($key, $options) && $options[$key] !== null
                    ? filter_var($options[$key], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE)
                    : null,
            ])
            ->all();
    }

    /**
     * Urutan tampil opsi T/F untuk sebuah soal pada attempt ini.
     *
     * Permutasi deterministik dari (exam, user, shuffle_pattern, question) —
     * sama persis tiap kali dihitung ulang, sehingga refresh halaman tidak
     * mengubah urutan dan penilaian konsisten dengan yang dilihat siswa.
     * Tiap siswa (user_id berbeda) menerima permutasi berbeda, sehingga pola
     * "pernyataan salah selalu di D" tidak lagi seragam antar peserta.
     *
     * @return array<int, string> mis. ['c','a','d','b'] = slot tampil A..D
     *                            menampilkan opsi kanonik c, a, d, b.
     */
    private function trueFalseOptionOrder(Attempt $attempt, int $questionId): array
    {
        $keys = ['a', 'b', 'c', 'd'];
        $seed = "tfopt:{$attempt->exam_id}:{$attempt->user_id}:{$attempt->shuffle_pattern}:{$questionId}";

        usort($keys, fn (string $left, string $right) => crc32("{$seed}:{$left}") <=> crc32("{$seed}:{$right}"));

        return $keys;
    }

    /**
     * Putar teks opsi A–D tiap soal true_false pada model yang sudah dimuat
     * agar siswa melihat opsi dalam urutan acak. Hanya untuk attempt baru
     * (tf_options_shuffled = true); attempt lama tetap urutan kanonik.
     */
    private function applyTrueFalseOptionShuffle(Attempt $attempt): void
    {
        if (! $attempt->tf_options_shuffled) {
            return;
        }

        foreach ($attempt->answers as $answer) {
            $question = $answer->question;
            if (! $question || ($question->question_type ?? null) !== 'true_false') {
                continue;
            }

            $order = $this->trueFalseOptionOrder($attempt, $question->id);
            $canonical = [
                'a' => $question->option_a,
                'b' => $question->option_b,
                'c' => $question->option_c,
                'd' => $question->option_d,
            ];

            $question->option_a = $canonical[$order[0]];
            $question->option_b = $canonical[$order[1]];
            $question->option_c = $canonical[$order[2]];
            $question->option_d = $canonical[$order[3]];
        }
    }

    /**
     * Kunci T/F (correct_options) diputar ke urutan tampil attempt ini agar
     * sebanding dengan selected_options yang tersimpan per posisi tampil.
     *
     * @return array<string, bool|null>
     */
    private function displayOrderedCorrectOptions(Attempt $attempt, $question): array
    {
        $canonical = $this->normalizeBooleanOptions($question->correct_options ?? []);

        if (! $attempt->tf_options_shuffled) {
            return $canonical;
        }

        $order = $this->trueFalseOptionOrder($attempt, $question->id);
        $slots = ['a', 'b', 'c', 'd'];

        return collect($slots)
            ->mapWithKeys(fn (string $slot, int $index) => [$slot => $canonical[$order[$index]]])
            ->all();
    }
}
