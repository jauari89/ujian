<?php

namespace Database\Seeders;

use App\Models\Course;
use App\Models\Exam;
use App\Models\ExamPackage;
use App\Models\Question;
use Illuminate\Database\Seeder;

class HotsAnimasi3DSeeder extends Seeder
{
    public function run(): void
    {
        $course = Course::firstOrCreate(
            ['slug' => 'animasi-3d'],
            ['name' => 'Animasi 3D', 'is_active' => true]
        );

        $exam = Exam::firstOrCreate(
            ['course_id' => $course->id, 'title' => 'Bank HOTS Animasi 3D'],
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
                'image_url' => '/hots/animasi-3d/soal-hots-animasi-3d-1.png',
                'question_text' => 'Jelaskan fungsi setiap tahap pada pipeline animasi 3D, identifikasi tahapan yang paling menentukan kualitas visual akhir, dan berikan alasan Anda.',
                'explanation' => 'Jawaban kuat menjelaskan alur dari ide cerita, script, storyboard, desain karakter/environment, modeling, texturing/shading, rigging, layout/camera, animation, lighting, rendering, compositing, editing, sampai output final. Analisis harus menyebut hubungan antar tahap dan memilih tahap paling menentukan kualitas visual dengan alasan teknis.',
            ],
            [
                'week' => 14,
                'image_url' => '/hots/animasi-3d/soal-hots-animasi-3d-2.png',
                'question_text' => 'Analisis perbedaan pendekatan render real-time dan offline. Menurut Anda, kapan Unity lebih tepat digunakan, dan kapan offline renderer lebih unggul? Jelaskan berdasarkan kebutuhan produksi.',
                'explanation' => 'Jawaban kuat membandingkan kecepatan, kualitas visual, interaktivitas, hardware, penggunaan utama, global illumination, refleksi/bayangan, dan workflow. Unity tepat untuk game, VR/AR, simulasi, training, dan previs cepat; offline renderer unggul untuk film, iklan, VFX, arsitektur, dan visual fotorealistis.',
            ],
            [
                'week' => 15,
                'image_url' => '/hots/animasi-3d/soal-hots-animasi-3d-3.png',
                'question_text' => 'Jelaskan konsep bumper dan peran compositing di dalamnya. Analisis bagaimana compositing dapat meningkatkan kualitas komunikasi visual sebuah bumper.',
                'explanation' => 'Jawaban kuat menjelaskan bumper sebagai video pendek pembuka/penutup untuk identitas visual, durasi singkat, logo, teks, musik, dan motion graphic. Compositing dibahas sebagai proses layering, color correction, VFX, dan final look yang memperkuat pesan, fokus visual, ritme, dan konsistensi brand.',
            ],
            [
                'week' => 16,
                'image_url' => '/hots/animasi-3d/soal-hots-animasi-3d-4.png',
                'question_text' => 'Berdasarkan pipeline di atas, jelaskan urutan kerja yang efektif untuk menghasilkan render atau compositing yang baik. Tahap mana yang paling berisiko menimbulkan kesalahan jika diabaikan? Berikan analisis Anda.',
                'explanation' => 'Jawaban kuat menjelaskan urutan scene preparation, model check, material/texture check, lighting setup, camera setup, render passes, compositing, color correction, review/QC, dan final output. Analisis risiko bisa menekankan model check, material/texture, lighting, render passes, atau QC dengan alasan dampaknya pada artefak, noise, konsistensi, dan kebutuhan revisi.',
            ],
        ];
    }
}
