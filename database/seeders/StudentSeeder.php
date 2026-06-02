<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class StudentSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Daftar mahasiswa per kelas. Username dan password default = NRP.
     * Sumber: export Smart Exam 2026-06-02.
     *
     * @var array<string, array<string, string>>
     */
    private array $classes = [
        '2 MMB' => [
            '5124500001' => 'Dzaky Haidar Siraaj',
            '5124500002' => 'Muhammad Ivan Ardianto',
            '5124500003' => 'Eryko Dwi Cahyo',
            '5124500004' => 'Zahra Nurizza Afifah',
            '5124500005' => 'Diska Ayu Kartika',
            '5124500006' => 'Muhammad Oktafiansyah Putra',
            '5124500007' => 'Hanafi Rizki Fikrillah',
            '5124500008' => 'Midha Annur Faisila',
            '5124500009' => 'Ikhwan Abdillah',
            '5124500010' => 'Muhammad Naufal',
            '5124500011' => 'Shilmi Aulia Yustina',
            '5124500012' => 'Maureen Aura Zefanya Indrayana',
            '5124500013' => 'Fatacio Naja Mahera Kusuma',
            '5124500014' => 'Ali Ridho',
            '5124500015' => 'Christopher Ryan Johnson',
            '5124500016' => 'Muhammad Yusuf Firdaus',
            '5124500017' => 'Gibran Amadeus Jastin',
            '5124500018' => 'Rafi Kurniawan Yogananda',
            '5124500019' => 'Mochammad Mirza Ubadah',
            '5124500020' => 'Ryan Hakim Firmansyah',
            '5124500021' => 'Yassinta Dwi Rahayu',
            '5124500022' => 'Marsha Yohan Widyarahma',
            '5124500023' => 'Azkiyatus Sholihah',
            '5124500024' => 'Bilqis Najiha Zahra',
            '5124500025' => 'Erlinda Rahmadina Aromi',
            '5124500026' => 'Putri Amalia Hamidah',
            '5124500027' => 'Ananda Safira Restiani',
            '5124500028' => 'Cantika Salsabrina Fiqih',
            '5124500029' => 'Umbu Rihi Lamma',
            '5124500030' => 'Mochammad Muflih Naufal Ramadhan',
            '5124500031' => 'Afhiz Novri Andika',
            '5124500032' => 'Alaudin Raka Diansaputra',
            '5124500033' => 'Kartika Rahma Aulia',
            '5124500034' => 'Diva Amalia',
            '5124500035' => 'Shafira Nur Fachriza',
            '5124500036' => 'Hairlangga',
            '5124500037' => 'Ester Aprilianevi',
            '5124500038' => 'Radit Andra Ahmad Canavaro',
            '5124500040' => 'Pradipta Adicandra Wicaksono',
            '5124500041' => 'Keisha Zhafif Fahrezi',
            '5124500042' => 'Allysa Avrilia Putri Salsabila',
            '5124500043' => 'Achmad Rehan Kaifa Zayn',
            '5124500044' => 'Tjan Victor',
            '5124500047' => 'Karennia Putri Baginda',
            '5124500049' => 'Achmad Mido Syamsidar Alfa Rizqi',
            '5124500050' => "Ahmad Sabiqul 'Alim",
            '5124500051' => 'Reky Dwi Saputra',
            '5124500052' => 'Ika Kurnia Wati',
            '5124500053' => 'Nanda Putra Syawaludin',
            '5124500054' => 'Azza Amaliah Zahara',
            '5124500055' => 'Muhammad Nabila Ilham',
            '5124500056' => 'Chandra Fachrul Aquariza',
            '5124500058' => 'Khansa Nadhif Shafa',
            '5124500059' => 'Muhammad Raffi',
        ],
        '3 MMB' => [
            '5123500001' => 'Aufar Rizky Ramadhani',
            '5123500002' => 'Irwin Ekaputra Anugrah',
            '5123500003' => 'Aryo Quais Adisuryo Waseso',
            '5123500004' => 'Annisa Rafa Fajar Rizkia',
            '5123500005' => 'Goldan Mahardhika',
            '5123500006' => 'Rayhan Nazhif Husain',
            '5123500007' => 'Ivan Belva Devianto',
            '5123500008' => 'Ariq Muhammad Zulfan Sabilly',
            '5123500009' => 'Misericordiaz Domine Siregar',
            '5123500010' => "Hulwan Widy Mahanja' Nihan",
            '5123500011' => 'Vallenta Bintang Samudra',
            '5123500012' => 'Hasnah Aulia Zahra',
            '5123500013' => 'Lyra Nasywa Athaya Putri Purwanto',
            '5123500014' => 'Muhammad Rakha Maulana',
            '5123500015' => 'Muchammad Alif Wahyu Wibowo',
            '5123500016' => 'Yeremia Raka Putra Seftian',
            '5123500017' => 'Bimo Harya Pangestu',
            '5123500018' => 'Harits Dwi Rahmatullah',
            '5123500019' => 'Irfan Dzaki Rizqulloh',
            '5123500020' => 'Muhammad Ihsan Afifudin',
            '5123500021' => 'Zhafran Abiyyu Darwisy Hendrian',
            '5123500022' => 'Daffa Dhiyaul Haq Sabilillah',
            '5123500023' => 'Moch. Azhar Fakhrudin',
            '5123500024' => 'Radithya Putra Prasetyo',
            '5123500025' => 'Arung Putra Atmadja',
            '5123500026' => 'Lintang Lily Setyorini',
            '5123500027' => "Naufal Diky Asma'Ul Putra",
            '5123500028' => 'Callista Laylie Salsabila Sugianto',
            '5123500029' => 'Raafi Albanna Anugrah',
            '5123500030' => 'M. Anshorul Umam',
        ],
    ];

    public function run(): void
    {
        foreach ($this->classes as $className => $students) {
            foreach ($students as $nrp => $name) {
                User::updateOrCreate(
                    ['nrp' => $nrp],
                    [
                        'name' => $name,
                        'email' => null,
                        'password' => Hash::make($nrp),
                        'role' => 'student',
                        'class_name' => $className,
                    ]
                );
            }
        }
    }
}
