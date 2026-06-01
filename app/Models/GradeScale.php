<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class GradeScale extends Model
{
    protected $fillable = [
        'course_id',
        'min_score',
        'max_score',
        'include_min',
        'include_max',
        'letter_grade',
        'numeric_grade',
        'category',
        'description',
        'sort_order',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'min_score' => 'float',
            'max_score' => 'float',
            'include_min' => 'boolean',
            'include_max' => 'boolean',
            'numeric_grade' => 'float',
            'sort_order' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    public function course()
    {
        return $this->belongsTo(Course::class);
    }

    public function contains(float $score): bool
    {
        $aboveMin = $this->include_min ? $score >= $this->min_score : $score > $this->min_score;
        $belowMax = $this->include_max ? $score <= $this->max_score : $score < $this->max_score;

        return $aboveMin && $belowMax;
    }

    public static function ensureDefaultsForCourse(Course $course): void
    {
        foreach (self::defaultScales() as $scale) {
            self::updateOrCreate(
                ['course_id' => $course->id, 'letter_grade' => $scale['letter_grade']],
                $scale
            );
        }
    }

    public static function defaultScales(): array
    {
        return [
            ['min_score' => 86, 'max_score' => 100, 'include_min' => true, 'include_max' => true, 'letter_grade' => 'A', 'numeric_grade' => 4.00, 'category' => 'Istimewa', 'description' => 'Nilai 86 sampai 100', 'sort_order' => 1, 'is_active' => true],
            ['min_score' => 81, 'max_score' => 86, 'include_min' => true, 'include_max' => false, 'letter_grade' => 'A-', 'numeric_grade' => 3.75, 'category' => 'Istimewa', 'description' => 'Nilai 81 sampai kurang dari 86', 'sort_order' => 2, 'is_active' => true],
            ['min_score' => 76, 'max_score' => 81, 'include_min' => true, 'include_max' => false, 'letter_grade' => 'AB', 'numeric_grade' => 3.50, 'category' => 'Sangat baik', 'description' => 'Nilai 76 sampai kurang dari 81', 'sort_order' => 3, 'is_active' => true],
            ['min_score' => 71, 'max_score' => 76, 'include_min' => true, 'include_max' => false, 'letter_grade' => 'B+', 'numeric_grade' => 3.25, 'category' => 'Sangat baik', 'description' => 'Nilai 71 sampai kurang dari 76', 'sort_order' => 4, 'is_active' => true],
            ['min_score' => 66, 'max_score' => 71, 'include_min' => true, 'include_max' => false, 'letter_grade' => 'B', 'numeric_grade' => 3.00, 'category' => 'Baik', 'description' => 'Nilai 66 sampai kurang dari 71', 'sort_order' => 5, 'is_active' => true],
            ['min_score' => 61, 'max_score' => 66, 'include_min' => true, 'include_max' => false, 'letter_grade' => 'BC', 'numeric_grade' => 2.50, 'category' => 'Cukup baik', 'description' => 'Nilai 61 sampai kurang dari 66', 'sort_order' => 6, 'is_active' => true],
            ['min_score' => 56, 'max_score' => 61, 'include_min' => true, 'include_max' => false, 'letter_grade' => 'C', 'numeric_grade' => 2.00, 'category' => 'Cukup', 'description' => 'Nilai 56 sampai kurang dari 61', 'sort_order' => 7, 'is_active' => true],
            ['min_score' => 41, 'max_score' => 56, 'include_min' => true, 'include_max' => false, 'letter_grade' => 'D', 'numeric_grade' => 1.00, 'category' => 'Kurang', 'description' => 'Nilai 41 sampai kurang dari 56', 'sort_order' => 8, 'is_active' => true],
            ['min_score' => 0, 'max_score' => 41, 'include_min' => true, 'include_max' => false, 'letter_grade' => 'E', 'numeric_grade' => 0.00, 'category' => 'Sangat kurang', 'description' => 'Nilai 0 sampai kurang dari 41', 'sort_order' => 9, 'is_active' => true],
        ];
    }
}
