<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Question extends Model
{
    protected $fillable = [
        'exam_id',
        'week',
        'question_text',
        'option_a',
        'option_b',
        'option_c',
        'option_d',
        'correct_option',
        'explanation',
    ];

    protected $hidden = ['correct_option'];

    protected function casts(): array
    {
        return ['week' => 'integer'];
    }

    public function exam()
    {
        return $this->belongsTo(Exam::class);
    }

    public function packages()
    {
        return $this->belongsToMany(ExamPackage::class, 'exam_package_question')
            ->withPivot('sort_order')
            ->withTimestamps();
    }

    public function attemptAnswers()
    {
        return $this->hasMany(AttemptAnswer::class);
    }
}
