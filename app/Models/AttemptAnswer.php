<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AttemptAnswer extends Model
{
    protected $fillable = [
        'attempt_id',
        'question_id',
        'display_order',
        'selected_option',
        'selected_options',
        'essay_answer',
        'file_path',
        'file_original_name',
        'file_size',
        'manual_score',
        'manual_feedback',
        'graded_at',
        'is_correct',
        'answered_at',
    ];

    protected function casts(): array
    {
        return [
            'is_correct' => 'boolean',
            'selected_options' => 'array',
            'answered_at' => 'datetime',
            'graded_at' => 'datetime',
            'manual_score' => 'float',
            'file_size' => 'integer',
            'display_order' => 'integer',
        ];
    }

    public function attempt()
    {
        return $this->belongsTo(Attempt::class);
    }

    public function question()
    {
        return $this->belongsTo(Question::class);
    }
}
