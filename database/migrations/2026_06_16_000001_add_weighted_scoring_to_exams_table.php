<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('exams', function (Blueprint $table) {
            // Bila true: nilai akhir = (ABCD+T/F) 50% + HOTS/Tugas 50%,
            // tiap blok berskala 0-100. Bila false: tiap soal 1 poin (default lama).
            $table->boolean('weighted_scoring')->default(false)->after('is_active');
        });
    }

    public function down(): void
    {
        Schema::table('exams', function (Blueprint $table) {
            $table->dropColumn('weighted_scoring');
        });
    }
};
