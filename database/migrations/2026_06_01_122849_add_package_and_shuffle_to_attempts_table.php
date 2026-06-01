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
            $table->foreignId('exam_package_id')
                ->nullable()
                ->after('exam_id')
                ->constrained()
                ->nullOnDelete();
            $table->unsignedTinyInteger('shuffle_pattern')->default(1)->after('exam_package_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('attempts', function (Blueprint $table) {
            $table->dropConstrainedForeignId('exam_package_id');
            $table->dropColumn('shuffle_pattern');
        });
    }
};
