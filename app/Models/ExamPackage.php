<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ExamPackage extends Model
{
    protected $fillable = ['exam_id', 'name', 'code', 'is_active'];

    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }

    public function exam()
    {
        return $this->belongsTo(Exam::class);
    }

    public function questions()
    {
        return $this->belongsToMany(Question::class, 'exam_package_question')
            ->withPivot('sort_order')
            ->withTimestamps()
            ->orderBy('exam_package_question.sort_order')
            ->orderBy('questions.id');
    }

    public static function ensureDefaultPackagesForExam(Exam $exam): void
    {
        foreach (['A', 'B', 'C'] as $code) {
            $package = self::firstOrCreate(
                ['exam_id' => $exam->id, 'code' => $code],
                ['name' => "Paket {$code}", 'is_active' => true]
            );

            self::syncPackageWithExamBank($package, $exam);
        }
    }

    public static function syncPackageWithExamBank(self $package, Exam $exam): void
    {
        $sync = $exam->questions()
            ->orderBy('week')
            ->orderBy('id')
            ->pluck('id')
            ->values()
            ->mapWithKeys(fn (int $questionId, int $index) => [
                $questionId => ['sort_order' => $index + 1],
            ])
            ->all();

        $package->questions()->sync($sync);
    }
}
