<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Course extends Model
{
    protected $fillable = ['name', 'slug', 'is_active'];

    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }

    public function exams()
    {
        return $this->hasMany(Exam::class);
    }

    public function gradeScales()
    {
        return $this->hasMany(GradeScale::class);
    }
}
