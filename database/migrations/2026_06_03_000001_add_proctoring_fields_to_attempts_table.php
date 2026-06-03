<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attempts', function (Blueprint $table) {
            $table->unsignedTinyInteger('proctor_warnings')->default(0)->after('total_questions');
            $table->boolean('proctor_violation')->default(false)->after('proctor_warnings');
            $table->json('proctor_events')->nullable()->after('proctor_violation');
        });
    }

    public function down(): void
    {
        Schema::table('attempts', function (Blueprint $table) {
            $table->dropColumn(['proctor_warnings', 'proctor_violation', 'proctor_events']);
        });
    }
};
