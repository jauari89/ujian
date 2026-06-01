<?php

namespace Database\Seeders;

use App\Models\Course;
use App\Models\Exam;
use App\Models\ExamPackage;
use App\Models\GradeScale;
use App\Models\Question;
use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        User::updateOrCreate(
            ['email' => 'admin@pens.local'],
            [
                'name' => 'Admin UTS K3L',
                'nrp' => null,
                'password' => Hash::make('Admin123!'),
                'role' => 'admin',
            ]
        );

        foreach (['2026000001', '2026000002', '2026000003'] as $nrp) {
            User::updateOrCreate(
                ['nrp' => $nrp],
                [
                    'name' => 'Mahasiswa '.$nrp,
                    'email' => null,
                    'password' => Hash::make($nrp),
                    'role' => 'student',
                ]
            );
        }

        $courses = collect(['K3L', 'Desain Web', 'Animasi 3D'])
            ->mapWithKeys(fn (string $name) => [
                $name => Course::firstOrCreate(
                    ['slug' => str($name)->slug()->toString()],
                    ['name' => $name, 'is_active' => true]
                ),
            ]);

        foreach ($courses as $course) {
            GradeScale::ensureDefaultsForCourse($course);
        }

        $exam = Exam::firstOrNew(['title' => 'UTS K3L']);
        $exam->fill([
            'course_id' => $courses['K3L']->id,
            'duration_minutes' => 60,
            'is_active' => true,
        ])->save();

        Exam::firstOrCreate(
            ['course_id' => $courses['Desain Web']->id, 'title' => 'UTS Desain Web'],
            ['duration_minutes' => 60, 'is_active' => true]
        );

        Exam::firstOrCreate(
            ['course_id' => $courses['Animasi 3D']->id, 'title' => 'UTS Animasi 3D'],
            ['duration_minutes' => 60, 'is_active' => true]
        );

        $samples = [
            [
                'week' => 1,
                'question_text' => 'Apa kepanjangan K3L dalam konteks keselamatan kerja?',
                'option_a' => 'Keuangan, Kualitas, Keselamatan, Lingkungan',
                'option_b' => 'Keselamatan, Kesehatan Kerja, dan Lingkungan',
                'option_c' => 'Keamanan, Ketertiban, Kebersihan, Lingkungan',
                'option_d' => 'Kebijakan, Kontrol, Kinerja, Lingkungan',
                'correct_option' => 'b',
            ],
            [
                'week' => 2,
                'question_text' => 'Tindakan pertama saat melihat potensi bahaya di area kerja adalah?',
                'option_a' => 'Mengabaikan jika belum terjadi kecelakaan',
                'option_b' => 'Menunggu instruksi tanpa melapor',
                'option_c' => 'Melaporkan dan mengendalikan risiko sesuai prosedur',
                'option_d' => 'Menyebarkan informasi tanpa verifikasi',
                'correct_option' => 'c',
            ],
        ];

        if (! $exam->questions()->exists()) {
            foreach ($samples as $question) {
                Question::updateOrCreate(
                    ['exam_id' => $exam->id, 'question_text' => $question['question_text']],
                    $question
                );
            }
        }

        ExamPackage::ensureDefaultPackagesForExam($exam);
    }

}
