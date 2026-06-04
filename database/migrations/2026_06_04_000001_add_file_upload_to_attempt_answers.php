<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attempt_answers', function (Blueprint $table) {
            $table->string('file_path')->nullable()->after('essay_answer');
            $table->string('file_original_name')->nullable()->after('file_path');
            $table->unsignedInteger('file_size')->nullable()->after('file_original_name');
            $table->decimal('manual_score', 5, 2)->nullable()->after('file_size');
            $table->text('manual_feedback')->nullable()->after('manual_score');
            $table->timestamp('graded_at')->nullable()->after('manual_feedback');
        });
    }

    public function down(): void
    {
        Schema::table('attempt_answers', function (Blueprint $table) {
            $table->dropColumn(['file_path', 'file_original_name', 'file_size', 'manual_score', 'manual_feedback', 'graded_at']);
        });
    }
};
