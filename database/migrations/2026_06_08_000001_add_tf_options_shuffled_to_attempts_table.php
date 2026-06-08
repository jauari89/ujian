<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Menandai attempt yang opsi T/F-nya diacak per-posisi saat penyajian.
     * Attempt lama (default false) tetap dinilai & ditampilkan dengan urutan
     * opsi kanonik, sehingga nilai & review historis tidak berubah.
     */
    public function up(): void
    {
        Schema::table('attempts', function (Blueprint $table) {
            $table->boolean('tf_options_shuffled')->default(false)->after('shuffle_pattern');
        });
    }

    public function down(): void
    {
        Schema::table('attempts', function (Blueprint $table) {
            $table->dropColumn('tf_options_shuffled');
        });
    }
};
