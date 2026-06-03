<?php

namespace Tests\Feature;

use App\Models\Attempt;
use App\Models\AttemptAnswer;
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

    public function test_student_proctoring_absence_events_are_recorded(): void
    {
        [$student, $exam] = $this->seedExam();
        $attemptId = $this->actingAs($student)->postJson("/api/exams/{$exam->id}/start")
            ->assertCreated()
            ->json('attempt.id');

        $this->actingAs($student)->postJson("/api/attempts/{$attemptId}/proctor-event", [
            'type' => 'camera_absence_warning',
            'absence_seconds' => 30,
            'warning_count' => 1,
            'message' => 'Peringatan 1/5: mendekat ke kamera/sistem.',
        ])->assertOk()
            ->assertJsonPath('attempt.proctor_warnings', 1)
            ->assertJsonPath('attempt.proctor_violation', false);

        $this->actingAs($student)->postJson("/api/attempts/{$attemptId}/proctor-event", [
            'type' => 'camera_absence_violation',
            'absence_seconds' => 180,
            'warning_count' => 6,
            'message' => 'Indikasi pelanggaran: person tidak terdeteksi lebih dari 5 peringatan.',
        ])->assertOk()
            ->assertJsonPath('attempt.proctor_warnings', 6)
            ->assertJsonPath('attempt.proctor_violation', true);

        $this->assertDatabaseHas('attempts', [
            'id' => $attemptId,
            'proctor_warnings' => 6,
            'proctor_violation' => true,
        ]);

        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-proctor@pens.local',
            'password' => Hash::make('Admin123!'),
            'role' => 'admin',
        ]);

        $this->actingAs($admin)->getJson("/api/admin/reports/results?exam_id={$exam->id}")
            ->assertOk()
            ->assertJsonPath('student_results.0.proctor_warnings', 6)
            ->assertJsonPath('student_results.0.proctor_violation', true);
    }

    public function test_question_bank_can_be_scoped_per_class(): void
    {
        $course = Course::create([
            'name' => 'Desain Web',
            'slug' => 'desain-web',
            'is_active' => true,
        ]);

        $exam = Exam::create([
            'course_id' => $course->id,
            'title' => 'UTS Desain Web',
            'duration_minutes' => 60,
            'is_active' => true,
        ]);

        $commonQuestion = Question::create([
            'exam_id' => $exam->id,
            'class_name' => null,
            'week' => 1,
            'question_text' => 'Soal umum',
            'option_a' => 'A',
            'option_b' => 'B',
            'option_c' => 'C',
            'option_d' => 'D',
            'correct_option' => 'a',
        ]);

        $classAQuestion = Question::create([
            'exam_id' => $exam->id,
            'class_name' => '2 MMB A',
            'week' => 1,
            'question_text' => 'Soal kelas A',
            'option_a' => 'A',
            'option_b' => 'B',
            'option_c' => 'C',
            'option_d' => 'D',
            'correct_option' => 'a',
        ]);

        $classBQuestion = Question::create([
            'exam_id' => $exam->id,
            'class_name' => '2 MMB B',
            'week' => 1,
            'question_text' => 'Soal kelas B',
            'option_a' => 'A',
            'option_b' => 'B',
            'option_c' => 'C',
            'option_d' => 'D',
            'correct_option' => 'a',
        ]);

        ExamPackage::ensureDefaultPackagesForExam($exam);

        $studentA = User::create([
            'nrp' => '2026000101',
            'name' => 'Student A',
            'password' => Hash::make('2026000101'),
            'role' => 'student',
            'class_name' => '2 MMB A',
        ]);

        $studentB = User::create([
            'nrp' => '2026000102',
            'name' => 'Student B',
            'password' => Hash::make('2026000102'),
            'role' => 'student',
            'class_name' => '2 MMB B',
        ]);

        $this->actingAs($studentA)->getJson('/api/exams/active?course_slug=desain-web')
            ->assertOk()
            ->assertJsonPath('exam.question_count', 2);

        $attemptAId = $this->actingAs($studentA)->postJson("/api/exams/{$exam->id}/start")
            ->assertCreated()
            ->assertJsonPath('attempt.total_questions', 2)
            ->json('attempt.id');
        $attemptAQuestionIds = Attempt::with('answers')->findOrFail($attemptAId)->answers->pluck('question_id')->all();
        $this->assertContains($commonQuestion->id, $attemptAQuestionIds);
        $this->assertContains($classAQuestion->id, $attemptAQuestionIds);
        $this->assertNotContains($classBQuestion->id, $attemptAQuestionIds);

        $attemptBId = $this->actingAs($studentB)->postJson("/api/exams/{$exam->id}/start")
            ->assertCreated()
            ->assertJsonPath('attempt.total_questions', 2)
            ->json('attempt.id');
        $attemptBQuestionIds = Attempt::with('answers')->findOrFail($attemptBId)->answers->pluck('question_id')->all();
        $this->assertContains($commonQuestion->id, $attemptBQuestionIds);
        $this->assertContains($classBQuestion->id, $attemptBQuestionIds);
        $this->assertNotContains($classAQuestion->id, $attemptBQuestionIds);
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

        $hotsId = $this->actingAs($admin)->postJson("/api/admin/exams/{$exam->id}/questions", [
            'week' => 5,
            'question_type' => 'hots',
            'question_text' => 'Pertanyaan HOTS',
            'option_a' => 'A',
            'option_b' => 'B',
            'option_c' => 'C',
            'option_d' => 'D',
            'correct_option' => 'b',
            'explanation' => 'Pembahasan HOTS',
        ])->assertCreated()
            ->assertJsonPath('question.question_type', 'hots')
            ->assertJsonPath('question.correct_option', 'b')
            ->json('question.id');

        $this->actingAs($admin)->deleteJson("/api/admin/exams/{$exam->id}/questions/{$hotsId}")
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

    public function test_attempt_runs_multiple_choice_then_ten_true_false_questions(): void
    {
        [$student, $exam] = $this->seedExam();
        foreach (range(1, 12) as $number) {
            Question::create([
                'exam_id' => $exam->id,
                'week' => 3,
                'question_type' => 'true_false',
                'question_text' => "Tentukan benar salah {$number}",
                'option_a' => 'Pernyataan A',
                'option_b' => 'Pernyataan B',
                'option_c' => 'Pernyataan C',
                'option_d' => 'Pernyataan D',
                'correct_option' => 'a',
                'correct_options' => ['a' => true, 'b' => false, 'c' => true, 'd' => false],
            ]);
        }

        $attemptId = $this->actingAs($student)->postJson("/api/exams/{$exam->id}/start")
            ->assertCreated()
            ->assertJsonPath('attempt.total_questions', 12)
            ->json('attempt.id');

        $attempt = Attempt::with('answers.question')->findOrFail($attemptId);
        $this->assertSame(2, $attempt->answers->take(2)->filter(fn (AttemptAnswer $answer) => $answer->question->question_type === 'multiple_choice')->count());
        $this->assertSame(10, $attempt->answers->filter(fn (AttemptAnswer $answer) => $answer->question->question_type === 'true_false')->count());

        foreach ($attempt->answers as $answer) {
            if ($answer->question->question_type === 'true_false') {
                $this->actingAs($student)->postJson("/api/attempts/{$attempt->id}/answer", [
                    'question_id' => $answer->question_id,
                    'selected_options' => ['a' => true, 'b' => false, 'c' => true, 'd' => false],
                ])->assertOk();
            } else {
                $this->actingAs($student)->postJson("/api/attempts/{$attempt->id}/answer", [
                    'question_id' => $answer->question_id,
                    'selected_option' => $answer->question->correct_option,
                ])->assertOk();
            }
        }

        $this->actingAs($student)->postJson("/api/attempts/{$attempt->id}/submit")
            ->assertOk()
            ->assertJsonPath('attempt.score', 12)
            ->assertJsonPath('attempt.percentage', 100);

        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-tf@pens.local',
            'password' => Hash::make('Admin123!'),
            'role' => 'admin',
        ]);

        $report = $this->actingAs($admin)->getJson("/api/admin/reports/results?exam_id={$exam->id}")
            ->assertOk()
            ->assertJsonPath('student_results.0.total_questions', 12)
            ->json();
        $trueFalseAnalysis = collect($report['question_analysis'])
            ->where('question_type', 'true_false')
            ->firstWhere('answered_total', 1);
        $this->assertNotNull($trueFalseAnalysis);
        $this->assertSame(1, $trueFalseAnalysis['answered_total']);
        $this->assertSame(1, $trueFalseAnalysis['correct_total']);
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
            'class_name' => '2 MMB A',
        ]);

        $studentB = User::create([
            'nrp' => '2026000002',
            'name' => 'Student B',
            'password' => Hash::make('2026000002'),
            'role' => 'student',
            'class_name' => '2 MMB B',
        ]);

        $studentThreeB = User::create([
            'nrp' => '2026000003',
            'name' => 'Student 3B',
            'password' => Hash::make('2026000003'),
            'role' => 'student',
            'class_name' => '3 MMB B',
        ]);

        $webCourse = $this->actingAs($admin)->postJson('/api/admin/courses', [
            'name' => 'Desain Web',
        ])->assertCreated()->json('course');

        $threeDCourse = $this->actingAs($admin)->postJson('/api/admin/courses', [
            'name' => 'Animasi 3D',
        ])->assertCreated()->json('course');

        $k3lCourse = $this->actingAs($admin)->postJson('/api/admin/courses', [
            'name' => 'K3L',
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

        Exam::create([
            'course_id' => $k3lCourse['id'],
            'title' => 'UTS K3L',
            'duration_minutes' => 60,
            'is_active' => true,
        ]);

        $this->actingAs($admin)->getJson('/api/admin/courses')
            ->assertOk()
            ->assertJsonPath('courses.0.name', 'Animasi 3D')
            ->assertJsonPath('courses.1.name', 'Desain Web');

        $classes = $this->actingAs($admin)->getJson('/api/admin/exams')
            ->assertOk()
            ->json('classes');
        $this->assertContains('2 MMB A', $classes);
        $this->assertContains('2 MMB B', $classes);
        $this->assertContains('3 MMB B', $classes);

        $this->actingAs($admin)->getJson("/api/admin/courses/{$webCourse['id']}/grade-scales")
            ->assertOk()
            ->assertJsonPath('grade_scales.0.letter_grade', 'A')
            ->assertJsonPath('grade_scales.8.letter_grade', 'E');

        $this->actingAs($student)->getJson('/api/exams/active?course_slug=desain-web')
            ->assertOk()
            ->assertJsonPath('exam.title', 'UTS Desain Web')
            ->assertJsonPath('exam.course.slug', 'desain-web');

        $studentACourses = $this->actingAs($student)->getJson('/api/courses')
            ->assertOk()
            ->json('courses');
        $this->assertSame(['animasi-3d', 'desain-web'], collect($studentACourses)->pluck('slug')->all());

        $studentBCourses = $this->actingAs($studentB)->getJson('/api/courses')
            ->assertOk()
            ->json('courses');
        $this->assertSame(['animasi-3d', 'desain-web'], collect($studentBCourses)->pluck('slug')->all());

        $studentThreeBCourses = $this->actingAs($studentThreeB)->getJson('/api/courses')
            ->assertOk()
            ->json('courses');
        $this->assertSame(['k3l'], collect($studentThreeBCourses)->pluck('slug')->all());
    }

    public function test_admin_can_read_master_data_summary(): void
    {
        [$student, $exam] = $this->seedExam();
        $student->update(['class_name' => '3 MMB A']);
        ExamPackage::ensureDefaultPackagesForExam($exam);

        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@pens.local',
            'password' => Hash::make('Admin123!'),
            'role' => 'admin',
        ]);

        $this->actingAs($student)->postJson("/api/exams/{$exam->id}/start")
            ->assertCreated();

        $this->actingAs($admin)->getJson('/api/admin/master-data')
            ->assertOk()
            ->assertJsonPath('summary.courses', 1)
            ->assertJsonPath('summary.exams', 1)
            ->assertJsonPath('summary.questions', 2)
            ->assertJsonPath('summary.students', 1)
            ->assertJsonPath('summary.classes', 1)
            ->assertJsonPath('summary.attempts', 1)
            ->assertJsonPath('summary.packages', 3)
            ->assertJsonPath('courses.0.name', 'K3L')
            ->assertJsonPath('exams.0.title', 'UTS K3L')
            ->assertJsonPath('classes.0.name', '3 MMB A')
            ->assertJsonPath('students.0.nrp', '2026000001');
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
            $student->update(['class_name' => '3 MMB A']);
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

        $payload = $this->actingAs($admin)->getJson("/api/admin/reports/results?exam_id={$exam->id}&class_name=3%20MMB%20A")
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
