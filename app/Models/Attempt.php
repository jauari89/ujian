<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Attempt extends Model
{
    protected $fillable = [
        'exam_id',
        'exam_package_id',
        'shuffle_pattern',
        'user_id',
        'started_at',
        'ends_at',
        'submitted_at',
        'status',
        'score',
        'percentage',
        'letter_grade',
        'numeric_grade',
        'grade_category',
        'total_questions',
        'proctor_warnings',
        'proctor_violation',
        'proctor_events',
    ];

    protected function casts(): array
    {
        return [
            'started_at' => 'datetime',
            'ends_at' => 'datetime',
            'submitted_at' => 'datetime',
            'score' => 'integer',
            'percentage' => 'float',
            'numeric_grade' => 'float',
            'shuffle_pattern' => 'integer',
            'total_questions' => 'integer',
            'proctor_warnings' => 'integer',
            'proctor_violation' => 'boolean',
            'proctor_events' => 'array',
        ];
    }

    public function exam()
    {
        return $this->belongsTo(Exam::class);
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function package()
    {
        return $this->belongsTo(ExamPackage::class, 'exam_package_id');
    }

    public function answers()
    {
        return $this->hasMany(AttemptAnswer::class)->orderBy('display_order');
    }

    /**
     * Satu sumber kebenaran untuk penilaian submit maupun koreksi manual dosen.
     *
     * Default: tiap soal = 1 poin. PG/TF dinilai otomatis (benar=1/salah=0),
     * HOTS/tugas dinilai manual (manual_score/100 poin). Soal manual yang belum
     * dikoreksi berkontribusi 0 (pending).
     *
     * Khusus Animasi 3D kelas 2 MMB A: nilai otomatis (ABCD + T/F) berbobot 50%
     * dan nilai HOTS/tugas berbobot 50%.
     *
     * @return array{0: float, 1: int, 2: float} [poin_didapat, total_soal, persentase]
     */
    public function combinedScore(): array
    {
        $this->loadMissing('answers.question', 'exam.course', 'user');

        if ($this->usesBalancedAnimationScore()) {
            return $this->balancedAnimationScore();
        }

        $earned = 0.0;
        $total = 0;
        foreach ($this->answers as $answer) {
            $total++;
            $earned += $this->answerPoint($answer);
        }

        $percentage = $total > 0 ? round(($earned / $total) * 100, 2) : 0.0;

        return [$earned, $total, $percentage];
    }

    private function usesBalancedAnimationScore(): bool
    {
        return $this->exam?->course?->slug === 'animasi-3d'
            && ($this->user?->class_name === '2 MMB A' || $this->exam?->class_name === '2 MMB A');
    }

    private function balancedAnimationScore(): array
    {
        $autoEarned = 0.0;
        $autoTotal = 0;
        $manualEarned = 0.0;
        $manualTotal = 0;

        foreach ($this->answers as $answer) {
            if ($this->isManualQuestion($answer)) {
                $manualTotal++;
                $manualEarned += $this->answerPoint($answer);
            } else {
                $autoTotal++;
                $autoEarned += $this->answerPoint($answer);
            }
        }

        $total = $autoTotal + $manualTotal;
        $autoPercentage = $autoTotal > 0 ? ($autoEarned / $autoTotal) * 100 : 0.0;
        $manualPercentage = $manualTotal > 0 ? ($manualEarned / $manualTotal) * 100 : 0.0;

        if ($autoTotal > 0 && $manualTotal > 0) {
            $percentage = round(($autoPercentage * 0.5) + ($manualPercentage * 0.5), 2);
        } elseif ($autoTotal > 0) {
            $percentage = round($autoPercentage, 2);
        } else {
            $percentage = round($manualPercentage, 2);
        }

        $earned = $total > 0 ? ($percentage / 100) * $total : 0.0;

        return [$earned, $total, $percentage];
    }

    private function answerPoint(AttemptAnswer $answer): float
    {
        if ($answer->is_correct !== null) {
            return $answer->is_correct ? 1.0 : 0.0;
        }

        if ($answer->manual_score !== null) {
            return max(0.0, min(100.0, (float) $answer->manual_score)) / 100;
        }

        return 0.0;
    }

    private function isManualQuestion(AttemptAnswer $answer): bool
    {
        return in_array($answer->question?->question_type, ['hots', 'file_upload'], true);
    }
}
