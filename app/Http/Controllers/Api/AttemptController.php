<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attempt;
use App\Models\AttemptAnswer;
use App\Models\GradeScale;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class AttemptController extends Controller
{
    public function show(Request $request, Attempt $attempt)
    {
        $this->authorizeAttempt($request, $attempt);
        $this->expireIfNeeded($attempt);

        $attempt->load([
            'exam:id,course_id,title,duration_minutes',
            'exam.course:id,name,slug',
            'package:id,name,code',
            'answers.question:id,exam_id,week,question_text,option_a,option_b,option_c,option_d',
        ]);

        return response()->json(['attempt' => $attempt]);
    }

    public function answer(Request $request, Attempt $attempt)
    {
        $this->authorizeAttempt($request, $attempt);
        $this->expireIfNeeded($attempt);

        $data = $request->validate([
            'question_id' => ['required', 'integer', Rule::exists('questions', 'id')->where('exam_id', $attempt->exam_id)],
            'selected_option' => ['required', Rule::in(['a', 'b', 'c', 'd'])],
        ]);

        if ($attempt->status !== 'in_progress' || now()->greaterThan($attempt->ends_at)) {
            $this->expireIfNeeded($attempt, true);

            return response()->json(['message' => 'Waktu ujian sudah habis. Jawaban tidak bisa diubah.'], 422);
        }

        $answer = AttemptAnswer::where('attempt_id', $attempt->id)
            ->where('question_id', $data['question_id'])
            ->firstOrFail();

        $answer->update([
            'selected_option' => $data['selected_option'],
            'answered_at' => now(),
        ]);

        return response()->json(['answer' => $answer]);
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
            'answers.question:id,exam_id,week,question_text,option_a,option_b,option_c,option_d',
        ]);

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

    private function scoreAttempt(Attempt $attempt): Attempt
    {
        $attempt->load('answers.question', 'exam.course');

        $score = 0;
        foreach ($attempt->answers as $answer) {
            $isCorrect = $answer->selected_option !== null
                && $answer->selected_option === $answer->question->correct_option;
            $answer->update(['is_correct' => $isCorrect]);
            $score += $isCorrect ? 1 : 0;
        }

        $percentage = $attempt->answers->count() > 0
            ? round(($score / $attempt->answers->count()) * 100, 2)
            : 0;
        $grade = $this->gradeFor($attempt, $percentage);

        $attempt->update([
            'submitted_at' => $attempt->submitted_at ?? now(),
            'status' => now()->greaterThan($attempt->ends_at) ? 'expired' : 'submitted',
            'score' => $score,
            'percentage' => $percentage,
            'letter_grade' => $grade?->letter_grade,
            'numeric_grade' => $grade?->numeric_grade,
            'grade_category' => $grade?->category,
            'total_questions' => $attempt->answers->count(),
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
}
