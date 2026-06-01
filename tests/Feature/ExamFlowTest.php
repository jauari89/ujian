<?php

namespace Tests\Feature;

use App\Models\Attempt;
use App\Models\Course;
use App\Models\Exam;
use App\Models\ExamPackage;
use App\Models\Question;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ExamFlowTest extends TestCase
{
    use RefreshDatabase;

    public function test_student_login_accepts_only_ten_digit_nrp(): void
    {
        User::create([
            'nrp' => '2026000001',
            'name' => 'Student',
            'password' => Hash::make('2026000001'),
            'role' => 'student',
        ]);

        $this->postJson('/api/auth/login', [
            'nrp' => '123',
            'password' => '123',
        ])->assertUnprocessable();

        $this->postJson('/api/auth/login', [
            'nrp' => '2026000001',
            'password' => '2026000001',
        ])->assertOk()->assertJsonPath('user.nrp', '2026000001');
    }

    public function test_start_exam_creates_sixty_minute_attempt_and_answers(): void
    {
        Carbon::setTestNow('2026-06-01 10:00:00');
        [$student, $exam] = $this->seedExam();

        $response = $this->actingAs($student)->postJson("/api/exams/{$exam->id}/start")
            ->assertCreated()
            ->json('attempt');

        $attempt = Attempt::findOrFail($response['id']);
        $this->assertSame('2026-06-01 10:00:00', $attempt->started_at->format('Y-m-d H:i:s'));
        $this->assertSame('2026-06-01 11:00:00', $attempt->ends_at->format('Y-m-d H:i:s'));
        $this->assertSame(2, $attempt->answers()->count());

        Carbon::setTestNow();
    }

    public function test_autosave_submit_and_expired_submit_flow(): void
    {
        Carbon::setTestNow('2026-06-01 10:00:00');
        [$student, $exam] = $this->seedExam();
        $attemptId = $this->actingAs($student)->postJson("/api/exams/{$exam->id}/start")->json('attempt.id');
        $attempt = Attempt::findOrFail($attemptId);
        $question = $exam->questions()->first();

        $this->actingAs($student)->postJson("/api/attempts/{$attempt->id}/answer", [
            'question_id' => $question->id,
            'selected_option' => $question->correct_option,
        ])->assertOk();

        $this->assertDatabaseHas('attempt_answers', [
            'attempt_id' => $attempt->id,
            'question_id' => $question->id,
            'selected_option' => $question->correct_option,
        ]);

        Carbon::setTestNow('2026-06-01 11:01:00');

        $this->actingAs($student)->postJson("/api/attempts/{$attempt->id}/answer", [
            'question_id' => $question->id,
            'selected_option' => 'd',
        ])->assertUnprocessable();

        $this->actingAs($student)->postJson("/api/attempts/{$attempt->id}/submit")
            ->assertOk()
            ->assertJsonPath('attempt.score', 1)
            ->assertJsonPath('attempt.percentage', 50)
            ->assertJsonPath('attempt.letter_grade', 'D')
            ->assertJsonPath('attempt.status', 'expired');

        Carbon::setTestNow();
    }

    public function test_admin_can_import_questions_from_json(): void
    {
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@pens.local',
            'password' => Hash::make('Admin123!'),
            'role' => 'admin',
        ]);

        $payload = [
            'exam_title' => 'UTS K3L',
            'duration_minutes' => 60,
            'questions' => collect(range(1, 60))->map(fn ($number) => [
                'week' => 1,
                'question_text' => "Soal {$number}",
                'option_a' => 'A',
                'option_b' => 'B',
                'option_c' => 'C',
                'option_d' => 'D',
                'correct_option' => 'a',
            ])->all(),
        ];

        $file = UploadedFile::fake()->createWithContent('questions.json', json_encode($payload));

        $this->actingAs($admin)->post('/api/admin/questions/import', [
            'file' => $file,
        ])->assertOk()->assertJsonPath('question_count', 60);

        $this->assertDatabaseCount('questions', 60);
        $this->assertDatabaseHas('courses', ['name' => 'K3L', 'slug' => 'k3l']);
        $this->assertDatabaseHas('grade_scales', ['letter_grade' => 'A', 'min_score' => 86, 'max_score' => 100]);
    }

    public function test_admin_can_crud_questions_for_an_exam(): void
    {
        [$student, $exam] = $this->seedExam();
        ExamPackage::ensureDefaultPackagesForExam($exam);

        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@pens.local',
            'password' => Hash::make('Admin123!'),
            'role' => 'admin',
        ]);

        $this->actingAs($admin)->getJson("/api/admin/exams/{$exam->id}/questions")
            ->assertOk()
            ->assertJsonPath('questions.0.correct_option', 'a');

        $createdId = $this->actingAs($admin)->postJson("/api/admin/exams/{$exam->id}/questions", [
            'week' => 3,
            'question_text' => 'Pertanyaan baru',
            'option_a' => 'A',
            'option_b' => 'B',
            'option_c' => 'C',
            'option_d' => 'D',
            'correct_option' => 'c',
            'explanation' => 'Pembahasan',
        ])->assertCreated()
            ->assertJsonPath('exam.questions_count', 3)
            ->json('question.id');

        $this->assertTrue($exam->packages()->withCount('questions')->get()->every(fn (ExamPackage $package) => $package->questions_count === 3));

        $this->actingAs($admin)->postJson("/api/admin/exams/{$exam->id}/questions/{$createdId}", [
            'week' => 4,
            'question_text' => 'Pertanyaan baru diedit',
            'option_a' => 'AA',
            'option_b' => 'BB',
            'option_c' => 'CC',
            'option_d' => 'DD',
            'correct_option' => 'd',
            'explanation' => null,
        ])->assertOk()
            ->assertJsonPath('question.week', 4)
            ->assertJsonPath('question.correct_option', 'd');

        $this->actingAs($admin)->deleteJson("/api/admin/exams/{$exam->id}/questions/{$createdId}")
            ->assertOk()
            ->assertJsonPath('exam.questions_count', 2);

        $attemptId = $this->actingAs($student)->postJson("/api/exams/{$exam->id}/start")
            ->assertCreated()
            ->json('attempt.id');
        $usedQuestion = Attempt::with('answers')->findOrFail($attemptId)->answers->first()->question_id;

        $this->actingAs($admin)->deleteJson("/api/admin/exams/{$exam->id}/questions/{$usedQuestion}")
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Soal sudah dipakai dalam attempt mahasiswa. Reset ujian terlebih dahulu sebelum menghapus soal ini.');
    }

    public function test_admin_can_manage_courses_and_active_exam_can_be_filtered(): void
    {
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@pens.local',
            'password' => Hash::make('Admin123!'),
            'role' => 'admin',
        ]);

        $student = User::create([
            'nrp' => '2026000001',
            'name' => 'Student',
            'password' => Hash::make('2026000001'),
            'role' => 'student',
        ]);

        $webCourse = $this->actingAs($admin)->postJson('/api/admin/courses', [
            'name' => 'Desain Web',
        ])->assertCreated()->json('course');

        $threeDCourse = $this->actingAs($admin)->postJson('/api/admin/courses', [
            'name' => 'Animasi 3D',
        ])->assertCreated()->json('course');

        Exam::create([
            'course_id' => $webCourse['id'],
            'title' => 'UTS Desain Web',
            'duration_minutes' => 60,
            'is_active' => true,
        ]);

        Exam::create([
            'course_id' => $threeDCourse['id'],
            'title' => 'UTS Animasi 3D',
            'duration_minutes' => 60,
            'is_active' => true,
        ]);

        $this->actingAs($admin)->getJson('/api/admin/courses')
            ->assertOk()
            ->assertJsonPath('courses.0.name', 'Animasi 3D')
            ->assertJsonPath('courses.1.name', 'Desain Web');

        $this->actingAs($admin)->getJson("/api/admin/courses/{$webCourse['id']}/grade-scales")
            ->assertOk()
            ->assertJsonPath('grade_scales.0.letter_grade', 'A')
            ->assertJsonPath('grade_scales.8.letter_grade', 'E');

        $this->actingAs($student)->getJson('/api/exams/active?course_slug=desain-web')
            ->assertOk()
            ->assertJsonPath('exam.title', 'UTS Desain Web')
            ->assertJsonPath('exam.course.slug', 'desain-web');
    }

    public function test_admin_can_control_exam_window_and_reset_attempts(): void
    {
        Carbon::setTestNow('2026-06-01 10:00:00');
        [$student, $exam] = $this->seedExam();
        $exam->update([
            'opens_at' => now()->addHour(),
            'closes_at' => now()->addHours(2),
            'is_active' => true,
        ]);

        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@pens.local',
            'password' => Hash::make('Admin123!'),
            'role' => 'admin',
        ]);

        $this->actingAs($student)->getJson('/api/exams/active?course_slug=k3l')
            ->assertNotFound();

        $this->actingAs($student)->postJson("/api/exams/{$exam->id}/start")
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Masa ujian belum dibuka.');

        $this->actingAs($admin)->getJson('/api/admin/exams')
            ->assertOk()
            ->assertJsonPath('exams.0.title', 'UTS K3L')
            ->assertJsonPath('exams.0.is_open_now', false);

        $this->actingAs($admin)->postJson("/api/admin/exams/{$exam->id}/settings", [
            'duration_minutes' => 45,
            'is_active' => true,
            'opens_at' => '2026-06-01 09:55:00',
            'closes_at' => '2026-06-01 12:00:00',
        ])->assertOk()
            ->assertJsonPath('exam.duration_minutes', 45)
            ->assertJsonPath('exam.is_open_now', true);

        $attemptId = $this->actingAs($student)->postJson("/api/exams/{$exam->id}/start")
            ->assertCreated()
            ->json('attempt.id');
        $this->assertSame('2026-06-01 10:45:00', Attempt::findOrFail($attemptId)->ends_at->format('Y-m-d H:i:s'));

        $this->actingAs($admin)->postJson("/api/admin/exams/{$exam->id}/reset-attempts")
            ->assertOk()
            ->assertJsonPath('deleted_attempts', 1);
        $this->assertDatabaseMissing('attempts', ['id' => $attemptId]);

        $this->actingAs($admin)->postJson("/api/admin/exams/{$exam->id}/settings", [
            'duration_minutes' => 45,
            'is_active' => false,
            'opens_at' => '2026-06-01 09:55:00',
            'closes_at' => '2026-06-01 12:00:00',
        ])->assertOk()
            ->assertJsonPath('exam.is_active', false);

        $this->actingAs($student)->postJson("/api/exams/{$exam->id}/start")
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Ujian ditutup oleh admin.');

        Carbon::setTestNow();
    }

    public function test_students_receive_different_packages_and_persistent_shuffle_patterns(): void
    {
        [$students, $exam] = $this->seedPackagedExam();

        $attempts = collect($students)->map(function (User $student) use ($exam) {
            $attemptId = $this->actingAs($student)->postJson("/api/exams/{$exam->id}/start")
                ->assertCreated()
                ->json('attempt.id');

            return Attempt::with(['answers', 'package'])->findOrFail($attemptId);
        });

        $this->assertSame(['A', 'B', 'C'], $attempts->map(fn (Attempt $attempt) => $attempt->package->code)->all());
        $this->assertTrue($attempts->every(fn (Attempt $attempt) => $attempt->shuffle_pattern >= 1 && $attempt->shuffle_pattern <= 10));

        $firstAttempt = $attempts->first();
        $firstOrder = $firstAttempt->answers->pluck('question_id')->all();
        $refetchedOrder = Attempt::with('answers')->findOrFail($firstAttempt->id)->answers->pluck('question_id')->all();

        $this->assertSame($firstOrder, $refetchedOrder);
        $this->assertNotSame($exam->questions()->orderBy('id')->pluck('id')->all(), $firstOrder);
    }

    public function test_admin_report_summarizes_student_results_and_question_analysis(): void
    {
        [$students, $exam] = $this->seedPackagedExam();
        foreach ($students as $student) {
            $student->update(['class_name' => '2 MMB']);
        }

        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@pens.local',
            'password' => Hash::make('Admin123!'),
            'role' => 'admin',
        ]);

        $attemptId = $this->actingAs($students[0])->postJson("/api/exams/{$exam->id}/start")
            ->assertCreated()
            ->json('attempt.id');

        $questions = $exam->questions()->orderBy('id')->get();
        foreach ($questions->take(8) as $question) {
            $this->actingAs($students[0])->postJson("/api/attempts/{$attemptId}/answer", [
                'question_id' => $question->id,
                'selected_option' => 'a',
            ])->assertOk();
        }

        $wrongQuestion = $questions->get(8);
        $this->actingAs($students[0])->postJson("/api/attempts/{$attemptId}/answer", [
            'question_id' => $wrongQuestion->id,
            'selected_option' => 'b',
        ])->assertOk();

        $this->actingAs($students[0])->postJson("/api/attempts/{$attemptId}/submit")
            ->assertOk()
            ->assertJsonPath('attempt.percentage', 80)
            ->assertJsonPath('attempt.letter_grade', 'AB');

        $payload = $this->actingAs($admin)->getJson("/api/admin/reports/results?exam_id={$exam->id}&class_name=2%20MMB")
            ->assertOk()
            ->assertJsonPath('summary.eligible_students', 3)
            ->assertJsonPath('summary.attempts_total', 1)
            ->assertJsonPath('summary.scored_total', 1)
            ->assertJsonPath('summary.average_percentage', 80)
            ->assertJsonPath('summary.completion_rate', 33.33)
            ->assertJsonPath('grade_distribution.0.label', 'AB')
            ->assertJsonPath('student_results.0.letter_grade', 'AB')
            ->json();

        $firstQuestionAnalysis = collect($payload['question_analysis'])->firstWhere('question_id', $questions->first()->id);
        $wrongQuestionAnalysis = collect($payload['question_analysis'])->firstWhere('question_id', $wrongQuestion->id);
        $emptyQuestionAnalysis = collect($payload['question_analysis'])->firstWhere('question_id', $questions->last()->id);

        $this->assertEquals(100, $firstQuestionAnalysis['correct_rate']);
        $this->assertSame(1, $wrongQuestionAnalysis['wrong_total']);
        $this->assertSame(1, $emptyQuestionAnalysis['unanswered_total']);
    }

    private function seedExam(): array
    {
        $student = User::create([
            'nrp' => '2026000001',
            'name' => 'Student',
            'password' => Hash::make('2026000001'),
            'role' => 'student',
        ]);

        $course = Course::create([
            'name' => 'K3L',
            'slug' => 'k3l',
            'is_active' => true,
        ]);

        $exam = Exam::create([
            'course_id' => $course->id,
            'title' => 'UTS K3L',
            'duration_minutes' => 60,
            'is_active' => true,
        ]);

        Question::create([
            'exam_id' => $exam->id,
            'week' => 1,
            'question_text' => 'Pertanyaan 1',
            'option_a' => 'A',
            'option_b' => 'B',
            'option_c' => 'C',
            'option_d' => 'D',
            'correct_option' => 'a',
        ]);

        Question::create([
            'exam_id' => $exam->id,
            'week' => 2,
            'question_text' => 'Pertanyaan 2',
            'option_a' => 'A',
            'option_b' => 'B',
            'option_c' => 'C',
            'option_d' => 'D',
            'correct_option' => 'b',
        ]);

        return [$student, $exam];
    }

    private function seedPackagedExam(): array
    {
        $course = Course::create([
            'name' => 'K3L',
            'slug' => 'k3l',
            'is_active' => true,
        ]);

        $exam = Exam::create([
            'course_id' => $course->id,
            'title' => 'UTS K3L',
            'duration_minutes' => 60,
            'is_active' => true,
        ]);

        foreach (range(1, 10) as $number) {
            Question::create([
                'exam_id' => $exam->id,
                'week' => 1,
                'question_text' => "Pertanyaan paket {$number}",
                'option_a' => 'A',
                'option_b' => 'B',
                'option_c' => 'C',
                'option_d' => 'D',
                'correct_option' => 'a',
            ]);
        }

        ExamPackage::ensureDefaultPackagesForExam($exam);

        $students = collect(['2026000001', '2026000002', '2026000003'])
            ->map(fn (string $nrp) => User::create([
                'nrp' => $nrp,
                'name' => 'Mahasiswa '.$nrp,
                'password' => Hash::make($nrp),
                'role' => 'student',
            ]))
            ->all();

        return [$students, $exam];
    }
}
