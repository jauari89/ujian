<?php

/*
|--------------------------------------------------------------------------
| Pembatasan akses ujian per kelas
|--------------------------------------------------------------------------
|
| Memetakan `class_name` mahasiswa ke daftar slug course yang BOLEH diakses.
| Kelas yang TIDAK terdaftar di sini tidak dibatasi (melihat semua ujian
| aktif) — menjaga kompatibilitas untuk akun lama/dummy/kelas baru.
|
| Slug course saat ini: k3l, desain-web, animasi-3d.
|
*/

return [
    '2 MMB A' => ['animasi-3d'],
    '2 MMB B' => ['desain-web'],
    '3 MMB A' => ['k3l'],
];
