<?php

use App\Http\Controllers\Api\AdminController;
use App\Http\Controllers\Api\AttemptController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\ExamController;
use Illuminate\Support\Facades\Route;

Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:5,1');

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);

    Route::get('/courses', [ExamController::class, 'courses']);
    Route::get('/exams/active', [ExamController::class, 'active']);
    Route::post('/exams/{exam}/start', [ExamController::class, 'start'])->middleware('role:student');

    Route::get('/attempts/{attempt}', [AttemptController::class, 'show']);
    Route::post('/attempts/{attempt}/answer', [AttemptController::class, 'answer'])->middleware('role:student');
    Route::post('/attempts/{attempt}/submit', [AttemptController::class, 'submit']);
    Route::get('/attempts/{attempt}/result', [AttemptController::class, 'result']);

    Route::middleware('role:admin')->group(function () {
        Route::get('/admin/master-data', [AdminController::class, 'masterData']);
        Route::get('/admin/students', [AdminController::class, 'students']);
        Route::post('/admin/students', [AdminController::class, 'storeStudent']);
        Route::post('/admin/students/{student}', [AdminController::class, 'updateStudent']);
        Route::delete('/admin/students/{student}', [AdminController::class, 'destroyStudent']);
        Route::get('/admin/courses', [AdminController::class, 'courses']);
        Route::post('/admin/courses', [AdminController::class, 'storeCourse']);
        Route::get('/admin/courses/{course}/grade-scales', [AdminController::class, 'gradeScales']);
        Route::get('/admin/exams/{exam}/packages', [AdminController::class, 'packages']);
        Route::post('/admin/exams/{exam}/packages', [AdminController::class, 'storePackage']);
        Route::get('/admin/exams', [AdminController::class, 'exams']);
        Route::post('/admin/exams/{exam}/settings', [AdminController::class, 'updateExamSettings']);
        Route::post('/admin/exams/{exam}/reset-attempts', [AdminController::class, 'resetExamAttempts']);
        Route::get('/admin/exams/{exam}/questions', [AdminController::class, 'questions']);
        Route::post('/admin/exams/{exam}/questions', [AdminController::class, 'storeQuestion']);
        Route::post('/admin/exams/{exam}/questions/{question}', [AdminController::class, 'updateQuestion']);
        Route::delete('/admin/exams/{exam}/questions/{question}', [AdminController::class, 'destroyQuestion']);
        Route::post('/admin/questions/import', [AdminController::class, 'importQuestions']);
        Route::get('/admin/attempts', [AdminController::class, 'attempts']);
        Route::get('/admin/reports/results', [AdminController::class, 'report']);
    });
});
