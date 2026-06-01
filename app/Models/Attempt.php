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
}
