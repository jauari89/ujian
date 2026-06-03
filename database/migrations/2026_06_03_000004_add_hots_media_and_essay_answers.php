<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('questions', function (Blueprint $table) {
            $table->string('level', 30)->nullable()->after('question_type');
            $table->text('image_url')->nullable()->after('question_text');
        });

        Schema::table('attempt_answers', function (Blueprint $table) {
            $table->longText('essay_answer')->nullable()->after('selected_options');
        });
    }

    public function down(): void
    {
        Schema::table('attempt_answers', function (Blueprint $table) {
            $table->dropColumn('essay_answer');
        });

        Schema::table('questions', function (Blueprint $table) {
            $table->dropColumn(['level', 'image_url']);
        });
    }
};
