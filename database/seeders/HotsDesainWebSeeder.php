<?php

namespace Database\Seeders;

use App\Models\Course;
use App\Models\Exam;
use App\Models\ExamPackage;
use App\Models\Question;
use Illuminate\Database\Seeder;

class HotsDesainWebSeeder extends Seeder
{
    public function run(): void
    {
        $course = Course::firstOrCreate(
            ['slug' => 'desain-web'],
            ['name' => 'Desain Web', 'is_active' => true]
        );

        $exam = Exam::firstOrCreate(
            ['course_id' => $course->id, 'title' => 'Bank HOTS Desain Web'],
            ['duration_minutes' => 60, 'is_active' => false]
        );

        foreach ($this->questions() as $question) {
            Question::updateOrCreate(
                [
                    'exam_id' => $exam->id,
                    'question_text' => $question['question_text'],
                ],
                array_merge($question, [
                    'class_name' => null,
                    'question_type' => 'hots',
                    'level' => 'berat',
                    'option_a' => 'Uraikan komponen utama.',
                    'option_b' => 'Jelaskan alur kerja.',
                    'option_c' => 'Analisis keterkaitan antarbagian.',
                    'option_d' => 'Berikan kesimpulan teknis.',
                    'correct_option' => 'a',
                    'correct_options' => null,
                ])
            );
        }

        ExamPackage::ensureDefaultPackagesForExam($exam);
    }

    private function questions(): array
    {
        return [
            [
                'week' => 13,
                'image_url' => '/hots/web-server-architecture.svg',
                'question_text' => 'Perhatikan gambar arsitektur web server. Jelaskan alur kerja ketika browser membuka sebuah halaman web mulai dari request, pemrosesan server, akses data, sampai response diterima kembali oleh browser.',
                'explanation' => 'Jawaban kuat menjelaskan browser/client, DNS/request HTTP, web server, aplikasi backend, database, response HTML/CSS/JS, status code, dan alasan tiap komponen saling terhubung.',
            ],
            [
                'week' => 14,
                'image_url' => '/hots/laravel-request-lifecycle.svg',
                'question_text' => 'Perhatikan gambar cara kerja Laravel. Jelaskan bagaimana request masuk ke aplikasi Laravel, melewati routing, controller, model/database, view, lalu menjadi response.',
                'explanation' => 'Jawaban kuat menyebut public/index.php, middleware, route, controller, model/Eloquent, database, Blade/view atau JSON response, serta peran MVC.',
            ],
            [
                'week' => 15,
                'image_url' => '/hots/laravel-blade-template.svg',
                'question_text' => 'Perhatikan gambar cara kerja template tampilan Laravel. Jelaskan bagaimana layout Blade, section/yield, component/partial, asset CSS/JS, dan data dari controller membentuk tampilan halaman.',
                'explanation' => 'Jawaban kuat menjelaskan layout utama, @yield/@section, @include/component, variable data dari controller, asset Vite/public, dan hasil render HTML.',
            ],
            [
                'week' => 16,
                'image_url' => '/hots/portfolio-template-change.svg',
                'question_text' => 'Perhatikan gambar alur mengganti template pada web portofolio/CV. Jelaskan langkah teknis mengganti template agar konten portofolio tetap dinamis dan tidak merusak route, asset, maupun data.',
                'explanation' => 'Jawaban kuat memuat analisis template lama/baru, pemetaan layout, pemindahan asset, penyesuaian Blade, data dinamis profil/proyek, route/controller, pengujian responsive, dan validasi link.',
            ],
        ];
    }
}
