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
     * Skor gabungan attempt: tiap soal = 1 poin. PG/TF dinilai otomatis
     * (is_correct true=1/false=0), HOTS/tugas dinilai manual (manual_score/100
     * poin); soal manual yang belum dikoreksi berkontribusi 0 (pending).
     * Satu sumber kebenaran untuk penilaian submit maupun koreksi manual dosen.
     *
     * @return array{0: float, 1: int, 2: float} [poin_didapat, total_soal, persentase]
     */
    public function combinedScore(): array
    {
        $this->loadMissing('answers');

        $earned = 0.0;
        $total = 0;
        foreach ($this->answers as $answer) {
            $total++;
            if ($answer->is_correct !== null) {
                $earned += $answer->is_correct ? 1 : 0;
            } elseif ($answer->manual_score !== null) {
                $earned += max(0.0, min(100.0, (float) $answer->manual_score)) / 100;
            }
        }

        $percentage = $total > 0 ? round(($earned / $total) * 100, 2) : 0.0;

        return [$earned, $total, $percentage];
    }
}
