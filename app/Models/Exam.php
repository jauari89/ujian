<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Exam extends Model
{
    protected $fillable = ['course_id', 'class_name', 'title', 'duration_minutes', 'is_active', 'opens_at', 'closes_at'];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'duration_minutes' => 'integer',
            'opens_at' => 'datetime',
            'closes_at' => 'datetime',
        ];
    }

    public function isOpenNow(): bool
    {
        return $this->is_active
            && (! $this->opens_at || now()->greaterThanOrEqualTo($this->opens_at))
            && (! $this->closes_at || now()->lessThanOrEqualTo($this->closes_at));
    }

    public function questions()
    {
        return $this->hasMany(Question::class);
    }

    public function packages()
    {
        return $this->hasMany(ExamPackage::class);
    }

    public function course()
    {
        return $this->belongsTo(Course::class);
    }

    public function attempts()
    {
        return $this->hasMany(Attempt::class);
    }
}
