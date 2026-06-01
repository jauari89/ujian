<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('attempts', function (Blueprint $table) {
            $table->decimal('percentage', 5, 2)->default(0)->after('score');
            $table->string('letter_grade', 10)->nullable()->after('percentage');
            $table->decimal('numeric_grade', 4, 2)->nullable()->after('letter_grade');
            $table->string('grade_category')->nullable()->after('numeric_grade');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('attempts', function (Blueprint $table) {
            $table->dropColumn(['percentage', 'letter_grade', 'numeric_grade', 'grade_category']);
        });
    }
};
