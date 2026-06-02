<?php

use App\Models\Course;
use App\Models\Exam;
use App\Models\ExamPackage;
use App\Models\GradeScale;
use App\Models\Question;
use App\Models\User;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Str;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('exam:import-json {file : Path file JSON soal} {--course= : Nama mata kuliah} {--title= : Judul ujian}', function (string $file) {
    $path = str_replace('\\', '/', $file);
    if (! is_file($path)) {
        $this->error("File tidak ditemukan: {$file}");

        return self::FAILURE;
    }

    $payload = json_decode(file_get_contents($path), true);
    if (! is_array($payload) || empty($payload['questions']) || ! is_array($payload['questions'])) {
        $this->error('Format JSON tidak valid atau tidak memiliki questions.');

        return self::FAILURE;
    }

    $courseName = $this->option('course') ?: ($payload['course_name'] ?? $payload['mata_kuliah'] ?? null);
    if (! $courseName) {
        $this->error('Nama mata kuliah wajib diisi dengan --course.');

        return self::FAILURE;
    }

    $examTitle = $this->option('title') ?: ($payload['exam_title'] ?? 'Ujian '.$courseName);
    $duration = (int) ($payload['duration_minutes'] ?? 60);

    $exam = DB::transaction(function () use ($courseName, $examTitle, $duration, $payload) {
        $course = Course::firstOrCreate(
            ['slug' => Str::slug($courseName)],
            ['name' => $courseName, 'is_active' => true]
        );
        GradeScale::ensureDefaultsForCourse($course);

        $exam = Exam::updateOrCreate(
            ['course_id' => $course->id, 'title' => $examTitle],
            ['duration_minutes' => $duration, 'is_active' => true]
        );

        foreach ($payload['questions'] as $question) {
            $questionType = $question['question_type'] ?? 'multiple_choice';
            $correctOptions = null;
            $correctOption = $question['correct_option'] ?? 'a';

            if ($questionType === 'true_false') {
                $correctOptions = collect(['a', 'b', 'c', 'd'])
                    ->mapWithKeys(fn (string $key) => [
                        $key => array_key_exists($key, $question['correct_options'] ?? [])
                            ? filter_var($question['correct_options'][$key], FILTER_VALIDATE_BOOLEAN)
                            : false,
                    ])
                    ->all();
            }

            Question::updateOrCreate(
                [
                    'exam_id' => $exam->id,
                    'question_text' => $question['question_text'],
                ],
                [
                    'week' => $question['week'] ?? null,
                    'question_type' => in_array($questionType, ['true_false', 'hots'], true) ? $questionType : 'multiple_choice',
                    'option_a' => $question['option_a'],
                    'option_b' => $question['option_b'],
                    'option_c' => $question['option_c'],
                    'option_d' => $question['option_d'],
                    'correct_option' => $correctOption,
                    'correct_options' => $correctOptions,
                    'explanation' => $question['explanation'] ?? null,
                ]
            );
        }

        ExamPackage::ensureDefaultPackagesForExam($exam);

        return $exam->load('course:id,name,slug')->loadCount('questions');
    });

    $this->info("Import selesai: {$exam->course->name} / {$exam->title}");
    $this->info("Total soal: {$exam->questions_count}");

    return self::SUCCESS;
})->purpose('Import bank soal JSON ke mata kuliah dan ujian');

Artisan::command('users:import-list {file : Path file daftar mahasiswa} {--class= : Nama kelas}', function (string $file) {
    $path = str_replace('\\', '/', $file);
    if (! is_file($path)) {
        $this->error("File tidak ditemukan: {$file}");

        return self::FAILURE;
    }

    $className = $this->option('class');
    if (! $className) {
        $this->error('Nama kelas wajib diisi dengan --class.');

        return self::FAILURE;
    }

    $text = file_get_contents($path);
    preg_match_all('/(512\d{7})\s+([^\r\n]+)/u', $text, $matches, PREG_SET_ORDER);

    $count = 0;
    foreach ($matches as $match) {
        $nrp = trim($match[1]);
        $name = trim(str_replace("\xc2\xa0", ' ', $match[2]));

        if (! preg_match('/^\d{10}$/', $nrp) || $name === '') {
            continue;
        }

        User::updateOrCreate(
            ['nrp' => $nrp],
            [
                'name' => $name,
                'email' => null,
                'password' => Hash::make($nrp),
                'role' => 'student',
                'class_name' => $className,
            ]
        );
        $count++;
    }

    $this->info("Import selesai: {$count} mahasiswa ke kelas {$className}");
    $this->info('Username dan password memakai NRP masing-masing.');

    return self::SUCCESS;
})->purpose('Import daftar mahasiswa dan set kelas');
