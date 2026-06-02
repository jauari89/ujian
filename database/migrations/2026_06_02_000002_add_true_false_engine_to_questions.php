<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('questions', function (Blueprint $table) {
            $table->string('question_type', 30)->default('multiple_choice')->after('week');
            $table->json('correct_options')->nullable()->after('correct_option');
            $table->index(['exam_id', 'question_type']);
        });

        Schema::table('attempt_answers', function (Blueprint $table) {
            $table->json('selected_options')->nullable()->after('selected_option');
        });
    }

    public function down(): void
    {
        Schema::table('attempt_answers', function (Blueprint $table) {
            $table->dropColumn('selected_options');
        });

        Schema::table('questions', function (Blueprint $table) {
            $table->dropIndex(['exam_id', 'question_type']);
            $table->dropColumn(['question_type', 'correct_options']);
        });
    }
};
