import './bootstrap';
import '../css/app.css';
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BarChart3, CalendarClock, Check, Clock, FileUp, LogOut, Pencil, Plus, Power, RotateCcw, ShieldCheck, Trash2, X } from 'lucide-react';

const api = {
    csrfReady: false,
    xsrfToken() {
        return decodeURIComponent(
            document.cookie
                .split('; ')
                .find((row) => row.startsWith('XSRF-TOKEN='))
                ?.split('=')[1] || ''
        );
    },
    async csrf() {
        if (this.csrfReady) return;
        await fetch('/sanctum/csrf-cookie', { credentials: 'include' });
        this.csrfReady = true;
    },
    async request(path, options = {}) {
        const response = await fetch(path, {
            headers: {
                Accept: 'application/json',
                ...(this.xsrfToken() ? { 'X-XSRF-TOKEN': this.xsrfToken() } : {}),
                ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
                ...(options.headers || {}),
            },
            credentials: 'include',
            ...options,
        });

        const text = await response.text();
        const json = text ? JSON.parse(text) : null;
        if (!response.ok) {
            throw new Error(json?.message || 'Request gagal.');
        }

        return json;
    },
    get(path) {
        return this.request(path);
    },
    post(path, body) {
        return this.request(path, {
            method: 'POST',
            body: body instanceof FormData ? body : JSON.stringify(body || {}),
        });
    },
    delete(path) {
        return this.request(path, { method: 'DELETE' });
    },
};

function App() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get('/api/auth/me')
            .then((data) => setUser(data.user))
            .catch(() => setUser(null))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="container">Memuat aplikasi...</div>;

    return (
        <BrowserRouter>
            <Shell user={user} setUser={setUser}>
                <Routes>
                    <Route path="/login" element={<Login setUser={setUser} />} />
                    <Route path="/courses" element={<Private user={user}><CourseSelect user={user} /></Private>} />
                    <Route path="/exam" element={<Private user={user}><ExamHome /></Private>} />
                    <Route path="/attempt/:id" element={<Private user={user}><AttemptPage /></Private>} />
                    <Route path="/result/:id" element={<Private user={user}><ResultPage /></Private>} />
                    <Route path="/admin/report" element={<Private user={user} role="admin"><AdminReport /></Private>} />
                    <Route path="/admin/import" element={<Private user={user} role="admin"><AdminImport /></Private>} />
                    <Route path="*" element={<Navigate to={user ? (user.role === 'admin' ? '/admin/report' : '/courses') : '/login'} />} />
                </Routes>
            </Shell>
        </BrowserRouter>
    );
}

function Shell({ children, user, setUser }) {
    const navigate = useNavigate();
    const logout = async () => {
        await api.post('/api/auth/logout');
        setUser(null);
        navigate('/login');
    };

    return (
        <div className="app-shell">
            <header className="topbar">
                <div className="brand"><span className="brand-mark"><ShieldCheck size={20} /></span> Smart Exam</div>
                {user && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="muted">{user.name} ({user.role})</span>
                        {user.role === 'admin' && <Link className="btn secondary" to="/admin/report"><BarChart3 size={17} /> Report</Link>}
                        {user.role === 'admin' && <Link className="btn secondary" to="/admin/import">Admin</Link>}
                        {user.role === 'student' && <Link className="btn secondary" to="/courses">Mata Kuliah</Link>}
                        <button className="btn secondary" onClick={logout}><LogOut size={17} /> Keluar</button>
                    </div>
                )}
            </header>
            <main className="container">{children}</main>
        </div>
    );
}

function Private({ user, role, children }) {
    if (!user) return <Navigate to="/login" />;
    if (role && user.role !== role) return <Navigate to="/courses" />;
    return children;
}

function Login({ setUser }) {
    const [nrp, setNrp] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const navigate = useNavigate();

    const submit = async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            await api.csrf();
            const data = await api.post('/api/auth/login', { nrp, password });
            setUser(data.user);
            navigate(data.user.role === 'admin' ? '/admin/report' : '/courses');
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="panel" style={{ maxWidth: 440, margin: '40px auto' }}>
            <h1>Smart Exam</h1>
            <p className="muted">Mahasiswa masuk dengan NRP 10 digit. Admin masuk dengan email.</p>
            {error && <div className="alert error">{error}</div>}
            <form onSubmit={submit}>
                <div className="field">
                    <label>NRP / Email Admin</label>
                    <input value={nrp} onChange={(e) => setNrp(e.target.value)} placeholder="2026000001" required />
                </div>
                <div className="field">
                    <label>Password</label>
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                <button className="btn primary" disabled={busy}>{busy ? 'Masuk...' : 'Masuk'}</button>
            </form>
        </div>
    );
}

function CourseSelect({ user }) {
    const [courses, setCourses] = useState([]);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        api.get('/api/courses')
            .then((data) => setCourses(data.courses || []))
            .catch((err) => setError(err.message));
    }, []);

    const allowedForClassTwo = ['desain-web', 'animasi-3d'];
    const allowedForClassThree = ['k3l'];
    const visibleCourses = user?.class_name?.startsWith('2')
        ? courses.filter((course) => allowedForClassTwo.includes(course.slug))
        : user?.class_name?.startsWith('3')
            ? courses.filter((course) => allowedForClassThree.includes(course.slug))
        : courses;

    return (
        <div className="grid">
            <section className="panel">
                <h1>Pilih Mata Kuliah</h1>
                <p className="muted">
                    {user?.class_name ? `Kelas ${user.class_name}` : 'Pilih ujian yang akan dikerjakan.'}
                </p>
                {error && <div className="alert error">{error}</div>}
                {!error && visibleCourses.length === 0 && <div className="alert">Belum ada mata kuliah aktif untuk kelas ini.</div>}
                <div className="course-grid">
                    {visibleCourses.map((course) => (
                        <button
                            key={course.id}
                            className="course-card"
                            onClick={() => navigate(`/exam?course_slug=${course.slug}`)}
                        >
                            <span>{course.name}</span>
                            <small>{course.exams_count || 0} ujian aktif</small>
                        </button>
                    ))}
                </div>
            </section>
        </div>
    );
}

function ExamHome() {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const courseSlug = searchParams.get('course_slug');

    useEffect(() => {
        if (!courseSlug) return;
        setData(null);
        setError('');
        api.get(`/api/exams/active?course_slug=${encodeURIComponent(courseSlug)}`).then(setData).catch((err) => setError(err.message));
    }, [courseSlug]);

    if (!courseSlug) return <Navigate to="/courses" />;

    const start = async () => {
        setBusy(true);
        setError('');
        try {
            const result = await api.post(`/api/exams/${data.exam.id}/start`);
            navigate(`/attempt/${result.attempt.id}`);
        } catch (err) {
            if (err.message.includes('Attempt') && data.attempt) navigate(`/attempt/${data.attempt.id}`);
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    if (error && !data) return <div className="alert error">{error}</div>;
    if (!data) return <div>Memuat ujian...</div>;

    const hasQuestions = data.exam.question_count > 0;
    const submitted = data.attempt && data.attempt.status !== 'in_progress';

    return (
        <div className="grid two">
            <section className="panel">
                <h1>{data.exam.title}</h1>
                {data.exam.course && <p className="muted">Mata kuliah: {data.exam.course.name}</p>}
                <p>Durasi ujian {data.exam.duration_minutes} menit sejak tombol Start ditekan. Timer mengikuti server, jadi refresh halaman tidak mengulang waktu.</p>
                {!hasQuestions && <div className="alert">Soal belum diimport.</div>}
                {error && <div className="alert error">{error}</div>}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {data.attempt && !submitted && <button className="btn primary" onClick={() => navigate(`/attempt/${data.attempt.id}`)}>Lanjutkan Attempt</button>}
                    {submitted && <button className="btn primary" onClick={() => navigate(`/result/${data.attempt.id}`)}>Lihat Hasil</button>}
                    {!data.attempt && <button className="btn primary" disabled={!hasQuestions || busy} onClick={start}>Start</button>}
                    <button className="btn secondary" onClick={() => navigate('/courses')}>Ganti Mata Kuliah</button>
                </div>
            </section>
            <aside className="panel">
                <div className="stat-row"><span>Jumlah soal</span><strong>{data.exam.question_count}</strong></div>
                <div className="stat-row"><span>Status</span><strong>{data.attempt?.status || 'belum mulai'}</strong></div>
                <div className="stat-row"><span>Durasi</span><strong>{data.exam.duration_minutes} menit</strong></div>
            </aside>
        </div>
    );
}

function AttemptPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [attempt, setAttempt] = useState(null);
    const [current, setCurrent] = useState(0);
    const [saving, setSaving] = useState('');
    const [error, setError] = useState('');
    const [now, setNow] = useState(Date.now());
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        api.get(`/api/attempts/${id}`).then((data) => setAttempt(data.attempt)).catch((err) => setError(err.message));
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, [id]);

    const answers = attempt?.answers || [];
    const active = answers[current];
    const remaining = useMemo(() => attempt ? Math.max(0, new Date(attempt.ends_at).getTime() - now) : 0, [attempt, now]);
    const warning = remaining <= 5 * 60 * 1000;

    useEffect(() => {
        if (attempt && remaining === 0 && attempt.status === 'in_progress') {
            submit(true);
        }
    }, [remaining, attempt]);

    const choose = async (option) => {
        if (!active || attempt.status !== 'in_progress') return;
        const optimistic = { ...attempt, answers: answers.map((item, index) => index === current ? { ...item, selected_option: option } : item) };
        setAttempt(optimistic);
        setSaving('Menyimpan...');
        try {
            await api.post(`/api/attempts/${id}/answer`, { question_id: active.question_id, selected_option: option });
            setSaving('Saved');
        } catch (err) {
            setError(err.message);
        }
    };

    const submit = async (auto = false) => {
        if (!auto && !confirm('Submit ujian sekarang?')) return;
        setSubmitting(true);
        try {
            await api.post(`/api/attempts/${id}/submit`);
            navigate(`/result/${id}`);
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (error && !attempt) return <div className="alert error">{error}</div>;
    if (!attempt || !active) return <div>Memuat attempt...</div>;

    const mm = String(Math.floor(remaining / 60000)).padStart(2, '0');
    const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');

    return (
        <div className="exam-layout">
            <section className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
                    <h2 style={{ margin: 0 }}>Soal {current + 1}</h2>
                    <span className={`timer ${warning ? 'warn' : ''}`}><Clock size={17} /> {mm}:{ss}</span>
                </div>
                {warning && <div className="alert">Waktu kurang dari 5 menit.</div>}
                {error && <div className="alert error">{error}</div>}
                <p className="question-text">{active.question.question_text}</p>
                {['a', 'b', 'c', 'd'].map((key) => (
                    <button key={key} className={`option ${active.selected_option === key ? 'selected' : ''}`} onClick={() => choose(key)}>
                        <span className="option-key">{key}</span>
                        <span>{active.question[`option_${key}`]}</span>
                    </button>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 18 }}>
                    <button className="btn secondary" onClick={() => setCurrent(Math.max(0, current - 1))}>Sebelumnya</button>
                    <span className="muted">{saving === 'Saved' ? <><Check size={14} /> Saved</> : saving}</span>
                    <button className="btn secondary" onClick={() => setCurrent(Math.min(answers.length - 1, current + 1))}>Berikutnya</button>
                </div>
            </section>
            <aside className="panel">
                <div className="stat-row"><span>Paket</span><strong>{attempt.package?.code || '-'}</strong></div>
                <div className="stat-row"><span>Pola acak</span><strong>{attempt.shuffle_pattern || '-'}/10</strong></div>
                <h3>Navigasi</h3>
                <div className="nav-grid">
                    {answers.map((answer, index) => (
                        <button
                            key={answer.id}
                            className={`nav-cell ${answer.selected_option ? 'answered' : ''} ${current === index ? 'active' : ''}`}
                            onClick={() => setCurrent(index)}
                        >
                            {index + 1}
                        </button>
                    ))}
                </div>
                <button className="btn danger" style={{ width: '100%', marginTop: 18 }} disabled={submitting} onClick={() => submit(false)}>
                    {submitting ? 'Submit...' : 'Submit'}
                </button>
            </aside>
        </div>
    );
}

function ResultPage() {
    const { id } = useParams();
    const [data, setData] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        api.get(`/api/attempts/${id}/result`).then(setData).catch((err) => setError(err.message));
    }, [id]);

    if (error) return <div className="alert error">{error}</div>;
    if (!data) return <div>Memuat hasil...</div>;

    return (
        <div className="panel">
            <h1>Hasil {data.attempt.exam.title}</h1>
            <p>Skor: <strong>{data.attempt.score}</strong> dari <strong>{data.attempt.total_questions}</strong> ({data.percentage}%).</p>
            <p>Grade: <strong>{data.grade?.letter || data.attempt.letter_grade || '-'}</strong>{data.grade?.category ? ` - ${data.grade.category}` : ''}</p>
            <p>Paket: <strong>{data.attempt.package?.code || '-'}</strong> | Pola acak: <strong>{data.attempt.shuffle_pattern || '-'}/10</strong></p>
            <div className="table-wrap">
                <table>
                    <thead><tr><th>No</th><th>Jawaban</th><th>Status</th></tr></thead>
                    <tbody>
                        {data.attempt.answers.map((answer, index) => (
                            <tr key={answer.id}>
                                <td>{index + 1}</td>
                                <td>{answer.selected_option || '-'}</td>
                                <td>{answer.is_correct ? 'Benar' : 'Salah'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function AdminReport() {
    const [report, setReport] = useState(null);
    const [filters, setFilters] = useState({ course_id: '', exam_id: '', class_name: '' });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
            if (value) params.set(key, value);
        });

        setLoading(true);
        setError('');
        api.get(`/api/admin/reports/results${params.toString() ? `?${params.toString()}` : ''}`)
            .then(setReport)
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [filters.course_id, filters.exam_id, filters.class_name]);

    const changeFilter = (key, value) => {
        setFilters((current) => ({
            ...current,
            [key]: value,
            ...(key === 'course_id' ? { exam_id: '' } : {}),
        }));
    };

    const courses = report?.meta?.courses || [];
    const exams = (report?.meta?.exams || []).filter((exam) => !filters.course_id || String(exam.course_id) === String(filters.course_id));
    const classes = report?.meta?.classes || [];
    const summary = report?.summary || {};
    const studentResults = report?.student_results || [];
    const questionAnalysis = report?.question_analysis || [];
    const analysisExam = report?.question_analysis_exam;
    const fmt = (value) => Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
    const pct = (value) => `${fmt(value)}%`;

    const summaryCards = [
        ['Mahasiswa', fmt(summary.eligible_students)],
        ['Attempt', fmt(summary.attempts_total)],
        ['Sudah Dinilai', fmt(summary.scored_total)],
        ['Rata-rata', pct(summary.average_percentage)],
        ['Tertinggi', pct(summary.highest_percentage)],
        ['Terendah', pct(summary.lowest_percentage)],
        ['Progress', fmt(summary.in_progress_total)],
        ['Selesai', pct(summary.completion_rate)],
    ];

    return (
        <div className="grid">
            <section className="panel">
                <div className="section-head">
                    <div>
                        <h1>Report & Analisa Hasil</h1>
                        <p className="muted">Rekap nilai mahasiswa, paket soal, grade, dan performa tiap butir soal.</p>
                    </div>
                    <button className="btn secondary" onClick={() => setFilters({ course_id: '', exam_id: '', class_name: '' })}>Reset Filter</button>
                </div>

                <div className="filter-row">
                    <div className="field">
                        <label>Mata Kuliah</label>
                        <select value={filters.course_id} onChange={(event) => changeFilter('course_id', event.target.value)}>
                            <option value="">Semua mata kuliah</option>
                            {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label>Ujian</label>
                        <select value={filters.exam_id} onChange={(event) => changeFilter('exam_id', event.target.value)}>
                            <option value="">Semua ujian</option>
                            {exams.map((exam) => (
                                <option key={exam.id} value={exam.id}>{exam.title}{exam.course ? ` - ${exam.course.name}` : ''}</option>
                            ))}
                        </select>
                    </div>
                    <div className="field">
                        <label>Kelas</label>
                        <select value={filters.class_name} onChange={(event) => changeFilter('class_name', event.target.value)}>
                            <option value="">Semua kelas</option>
                            {classes.map((className) => <option key={className} value={className}>{className}</option>)}
                        </select>
                    </div>
                </div>

                {error && <div className="alert error">{error}</div>}
                {loading && <div className="muted">Memuat report...</div>}
            </section>

            {report && (
                <>
                    <section className="panel">
                        <div className="metric-grid">
                            {summaryCards.map(([label, value]) => (
                                <div className="metric" key={label}>
                                    <span>{label}</span>
                                    <strong>{value}</strong>
                                </div>
                            ))}
                        </div>
                    </section>

                    <div className="grid two">
                        <section className="panel">
                            <h2>Distribusi Grade</h2>
                            <DistributionList items={report.grade_distribution || []} />
                        </section>
                        <section className="panel">
                            <h2>Distribusi Paket</h2>
                            <DistributionList items={report.package_distribution || []} />
                        </section>
                    </div>

                    <section className="panel">
                        <h2>Hasil Mahasiswa</h2>
                        <div className="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Nama</th>
                                        <th>NRP</th>
                                        <th>Kelas</th>
                                        <th>Mata Kuliah</th>
                                        <th>Ujian</th>
                                        <th>Paket</th>
                                        <th>Pola</th>
                                        <th>Status</th>
                                        <th>Skor</th>
                                        <th>Nilai</th>
                                        <th>Grade</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {studentResults.map((attempt) => (
                                        <tr key={attempt.id}>
                                            <td>{attempt.student?.name || '-'}</td>
                                            <td>{attempt.student?.nrp || '-'}</td>
                                            <td>{attempt.student?.class_name || '-'}</td>
                                            <td>{attempt.course || '-'}</td>
                                            <td>{attempt.exam || '-'}</td>
                                            <td>{attempt.package || '-'}</td>
                                            <td>{attempt.shuffle_pattern ? `${attempt.shuffle_pattern}/10` : '-'}</td>
                                            <td>{attempt.status}</td>
                                            <td>{attempt.score}/{attempt.total_questions}</td>
                                            <td>{pct(attempt.percentage)}</td>
                                            <td><span className="badge">{attempt.letter_grade || '-'}</span></td>
                                        </tr>
                                    ))}
                                    {studentResults.length === 0 && <tr><td colSpan="11">Belum ada attempt sesuai filter.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section className="panel">
                        <div className="section-head">
                            <div>
                                <h2>Analisa Butir Soal</h2>
                                <p className="muted">{analysisExam ? `${analysisExam.title}${analysisExam.course ? ` - ${analysisExam.course.name}` : ''}` : 'Pilih mata kuliah atau ujian untuk melihat analisa butir soal.'}</p>
                            </div>
                        </div>
                        <div className="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>No</th>
                                        <th>Minggu</th>
                                        <th>Soal</th>
                                        <th>Dijawab</th>
                                        <th>Benar</th>
                                        <th>Salah</th>
                                        <th>Kosong</th>
                                        <th>Akurasi</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {questionAnalysis.map((question) => (
                                        <tr key={question.question_id}>
                                            <td>{question.number}</td>
                                            <td>{question.week || '-'}</td>
                                            <td className="wrap-cell">{question.question_text}</td>
                                            <td>{question.answered_total}</td>
                                            <td>{question.correct_total}</td>
                                            <td>{question.wrong_total}</td>
                                            <td>{question.unanswered_total}</td>
                                            <td>{pct(question.correct_rate)}</td>
                                        </tr>
                                    ))}
                                    {questionAnalysis.length === 0 && <tr><td colSpan="8">Belum ada analisa butir soal untuk filter ini.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}

function DistributionList({ items }) {
    const max = Math.max(1, ...items.map((item) => item.total));

    if (!items.length) {
        return <div className="muted">Belum ada data.</div>;
    }

    return (
        <div className="distribution-list">
            {items.map((item) => (
                <div className="distribution-row" key={item.label}>
                    <span>{item.label}</span>
                    <div className="distribution-bar"><i style={{ width: `${(item.total / max) * 100}%` }} /></div>
                    <strong>{item.total}</strong>
                </div>
            ))}
        </div>
    );
}

function toDatetimeLocal(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (number) => String(number).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(value) {
    if (!value) return 'Belum diatur';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Belum diatur';

    return date.toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function examStatus(exam) {
    if (!exam) return { label: '-', className: 'closed' };
    if (exam.is_open_now) return { label: 'Sedang dibuka', className: 'open' };
    if (exam.is_active) return { label: 'Terjadwal', className: 'scheduled' };

    return { label: 'Ditutup', className: 'closed' };
}

const emptyQuestionForm = {
    week: '',
    question_text: '',
    option_a: '',
    option_b: '',
    option_c: '',
    option_d: '',
    correct_option: 'a',
    explanation: '',
};

function AdminImport() {
    const [file, setFile] = useState(null);
    const [message, setMessage] = useState('');
    const [attempts, setAttempts] = useState([]);
    const [exams, setExams] = useState([]);
    const [classes, setClasses] = useState([]);
    const [selectedExamId, setSelectedExamId] = useState('');
    const [settings, setSettings] = useState({ duration_minutes: 60, is_active: true, opens_at: '', closes_at: '' });
    const [resetClass, setResetClass] = useState('');
    const [questions, setQuestions] = useState([]);
    const [questionForm, setQuestionForm] = useState(emptyQuestionForm);
    const [editingQuestionId, setEditingQuestionId] = useState(null);
    const [busy, setBusy] = useState('');

    const loadAttempts = () => api.get('/api/admin/attempts').then((data) => setAttempts(data.attempts.data));
    const loadExams = () => api.get('/api/admin/exams').then((data) => {
        setExams(data.exams || []);
        setClasses(data.classes || []);
        setSelectedExamId((current) => current || String(data.exams?.[0]?.id || ''));
    });

    useEffect(() => {
        loadAttempts();
        loadExams();
    }, []);

    const selectedExam = exams.find((exam) => String(exam.id) === String(selectedExamId));
    const selectedStatus = examStatus(selectedExam);
    const totalQuestions = exams.reduce((total, exam) => total + Number(exam.questions_count || 0), 0);
    const openExams = exams.filter((exam) => exam.is_open_now).length;
    const totalAttempts = exams.reduce((total, exam) => total + Number(exam.attempts_count || 0), 0);
    const latestAttempts = attempts.slice(0, 12);
    const editingQuestion = questions.find((question) => question.id === editingQuestionId);

    const loadQuestions = (examId = selectedExamId) => {
        if (!examId) {
            setQuestions([]);
            return Promise.resolve();
        }

        return api.get(`/api/admin/exams/${examId}/questions`).then((data) => setQuestions(data.questions || []));
    };

    useEffect(() => {
        if (!selectedExam) return;
        setSettings({
            duration_minutes: selectedExam.duration_minutes || 60,
            is_active: Boolean(selectedExam.is_active),
            opens_at: toDatetimeLocal(selectedExam.opens_at),
            closes_at: toDatetimeLocal(selectedExam.closes_at),
        });
    }, [selectedExamId, selectedExam?.duration_minutes, selectedExam?.is_active, selectedExam?.opens_at, selectedExam?.closes_at]);

    useEffect(() => {
        setQuestionForm(emptyQuestionForm);
        setEditingQuestionId(null);
        loadQuestions(selectedExamId);
    }, [selectedExamId]);

    const upload = async (event) => {
        event.preventDefault();
        if (!file) return;
        const body = new FormData();
        body.append('file', file);
        const data = await api.post('/api/admin/questions/import', body);
        setMessage(`${data.message} Total soal: ${data.question_count}.`);
        await loadExams();
    };

    const saveSettings = async (nextActive = settings.is_active) => {
        if (!selectedExam) return;
        setBusy('settings');
        setMessage('');
        try {
            const data = await api.post(`/api/admin/exams/${selectedExam.id}/settings`, {
                duration_minutes: Number(settings.duration_minutes || 60),
                is_active: nextActive,
                opens_at: settings.opens_at || null,
                closes_at: settings.closes_at || null,
            });
            setMessage(`${data.message} Masa ujian tersimpan.`);
            await Promise.all([loadExams(), loadQuestions()]);
        } catch (err) {
            setMessage(err.message);
        } finally {
            setBusy('');
        }
    };

    const resetExam = async () => {
        if (!selectedExam) return;
        const scope = resetClass ? `kelas ${resetClass}` : 'semua kelas';
        if (!confirm(`Reset semua attempt ${selectedExam.title} untuk ${scope}? Mahasiswa bisa mulai ujian lagi dari awal.`)) return;

        setBusy('reset');
        setMessage('');
        try {
            const data = await api.post(`/api/admin/exams/${selectedExam.id}/reset-attempts`, {
                class_name: resetClass || null,
            });
            setMessage(data.message);
            await Promise.all([loadExams(), loadAttempts()]);
        } catch (err) {
            setMessage(err.message);
        } finally {
            setBusy('');
        }
    };

    const editQuestion = (question) => {
        setEditingQuestionId(question.id);
        setQuestionForm({
            week: question.week || '',
            question_text: question.question_text || '',
            option_a: question.option_a || '',
            option_b: question.option_b || '',
            option_c: question.option_c || '',
            option_d: question.option_d || '',
            correct_option: question.correct_option || 'a',
            explanation: question.explanation || '',
        });
    };

    const clearQuestionForm = () => {
        setEditingQuestionId(null);
        setQuestionForm(emptyQuestionForm);
    };

    const saveQuestion = async (event) => {
        event.preventDefault();
        if (!selectedExam) return;

        setBusy('question');
        setMessage('');
        try {
            const payload = {
                ...questionForm,
                week: questionForm.week ? Number(questionForm.week) : null,
            };
            const path = editingQuestionId
                ? `/api/admin/exams/${selectedExam.id}/questions/${editingQuestionId}`
                : `/api/admin/exams/${selectedExam.id}/questions`;
            const data = await api.post(path, payload);
            setMessage(data.message);
            clearQuestionForm();
            await Promise.all([loadQuestions(selectedExam.id), loadExams()]);
        } catch (err) {
            setMessage(err.message);
        } finally {
            setBusy('');
        }
    };

    const deleteQuestion = async (question) => {
        if (!selectedExam) return;
        if (!confirm(`Hapus soal ini dari ${selectedExam.title}?`)) return;

        setBusy('question');
        setMessage('');
        try {
            const data = await api.delete(`/api/admin/exams/${selectedExam.id}/questions/${question.id}`);
            setMessage(data.message);
            if (editingQuestionId === question.id) clearQuestionForm();
            await Promise.all([loadQuestions(selectedExam.id), loadExams()]);
        } catch (err) {
            setMessage(err.message);
        } finally {
            setBusy('');
        }
    };

    return (
        <div className="admin-page">
            <section className="admin-titlebar">
                <div>
                    <h1>Admin Console</h1>
                    <p className="muted">Kelola bank soal, masa ujian, status akses, dan reset attempt mahasiswa.</p>
                </div>
                <Link className="btn secondary" to="/admin/report"><BarChart3 size={17} /> Buka Report</Link>
            </section>

            {message && <div className={`alert ${message.toLowerCase().includes('gagal') || message.toLowerCase().includes('error') ? 'error' : ''}`}>{message}</div>}

            <section className="admin-overview" aria-label="Ringkasan admin">
                <div className="overview-item">
                    <span>Ujian Aktif</span>
                    <strong>{openExams}</strong>
                </div>
                <div className="overview-item">
                    <span>Total Ujian</span>
                    <strong>{exams.length}</strong>
                </div>
                <div className="overview-item">
                    <span>Bank Soal</span>
                    <strong>{totalQuestions}</strong>
                </div>
                <div className="overview-item">
                    <span>Attempt</span>
                    <strong>{totalAttempts}</strong>
                </div>
            </section>

            <div className="admin-main-grid">
                <aside className="panel admin-rail">
                    <div className="compact-head">
                        <h2>Daftar Ujian</h2>
                        <span>{exams.length}</span>
                    </div>
                    <div className="exam-list">
                        {exams.map((exam) => {
                            const status = examStatus(exam);
                            return (
                                <button
                                    key={exam.id}
                                    className={`exam-list-item ${String(exam.id) === String(selectedExamId) ? 'active' : ''}`}
                                    onClick={() => setSelectedExamId(String(exam.id))}
                                >
                                    <span>
                                        <strong>{exam.title}</strong>
                                        <small>{exam.course?.name || '-'} | {exam.questions_count} soal</small>
                                    </span>
                                    <i className={`status-dot ${status.className}`} />
                                </button>
                            );
                        })}
                    </div>

                    <form className="import-box" onSubmit={upload}>
                        <h3>Import Soal</h3>
                        <input className="file-input" type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files[0])} />
                        <button className="btn primary"><FileUp size={17} /> Import JSON</button>
                    </form>
                </aside>

                <section className="panel admin-control">
                    <div className="section-head">
                        <div>
                            <h2>{selectedExam?.title || 'Pengaturan Ujian'}</h2>
                            <p className="muted">{selectedExam?.course?.name || 'Pilih ujian untuk mengatur akses mahasiswa.'}</p>
                        </div>
                        {selectedExam && <span className={`status-pill ${selectedStatus.className}`}>{selectedStatus.label}</span>}
                    </div>

                    {selectedExam && (
                        <>
                            <div className="exam-snapshot">
                                <div>
                                    <span>Mulai</span>
                                    <strong>{formatDateTime(selectedExam.opens_at)}</strong>
                                </div>
                                <div>
                                    <span>Selesai</span>
                                    <strong>{formatDateTime(selectedExam.closes_at)}</strong>
                                </div>
                                <div>
                                    <span>Durasi</span>
                                    <strong>{selectedExam.duration_minutes} menit</strong>
                                </div>
                            </div>

                            <div className="settings-grid">
                                <div className="field">
                                    <label>Durasi</label>
                                    <input type="number" min="1" max="300" value={settings.duration_minutes} onChange={(event) => setSettings({ ...settings, duration_minutes: event.target.value })} />
                                </div>
                                <div className="field">
                                    <label>Mulai</label>
                                    <input type="datetime-local" value={settings.opens_at} onChange={(event) => setSettings({ ...settings, opens_at: event.target.value })} />
                                </div>
                                <div className="field">
                                    <label>Selesai</label>
                                    <input type="datetime-local" value={settings.closes_at} onChange={(event) => setSettings({ ...settings, closes_at: event.target.value })} />
                                </div>
                            </div>

                            <div className="action-row split">
                                <button className="btn primary" disabled={busy === 'settings'} onClick={() => saveSettings(true)}><Power size={17} /> Buka Ujian</button>
                                <button className="btn secondary" disabled={busy === 'settings'} onClick={() => saveSettings(false)}><Power size={17} /> Tutup</button>
                                <button className="btn secondary" disabled={busy === 'settings'} onClick={() => saveSettings(settings.is_active)}><CalendarClock size={17} /> Simpan Masa</button>
                            </div>

                            <div className="reset-box">
                                <div>
                                    <h3>Reset Attempt</h3>
                                    <p className="muted">Hapus attempt ujian terpilih agar mahasiswa dapat mulai ulang.</p>
                                </div>
                                <div className="field">
                                    <label>Kelas</label>
                                    <select value={resetClass} onChange={(event) => setResetClass(event.target.value)}>
                                        <option value="">Semua kelas</option>
                                        {classes.map((className) => <option key={className} value={className}>{className}</option>)}
                                    </select>
                                </div>
                                <button className="btn danger" disabled={!selectedExam || busy === 'reset'} onClick={resetExam}><RotateCcw size={17} /> Reset</button>
                            </div>
                        </>
                    )}
                </section>
            </div>

            <section className="panel question-manager">
                <div className="section-head">
                    <div>
                        <h2>CRUD Soal</h2>
                        <p className="muted">{selectedExam ? `${selectedExam.course?.name || '-'} | ${questions.length} soal` : 'Pilih ujian untuk mengelola soal.'}</p>
                    </div>
                    {editingQuestionId && <button className="btn secondary" onClick={clearQuestionForm}><X size={17} /> Batal Edit</button>}
                </div>

                <div className="question-workspace">
                    <div className="question-list-panel">
                        <div className="compact-head">
                            <h3>Bank Soal</h3>
                            <button className="btn secondary" onClick={() => loadQuestions()} disabled={!selectedExam}>Refresh</button>
                        </div>
                        <div className="question-list">
                            {questions.map((question, index) => (
                                <button
                                    key={question.id}
                                    className={`question-list-item ${editingQuestionId === question.id ? 'active' : ''}`}
                                    onClick={() => editQuestion(question)}
                                >
                                    <span className="question-number">{index + 1}</span>
                                    <span>
                                        <strong>{question.question_text}</strong>
                                        <small>Minggu {question.week || '-'} | Kunci {String(question.correct_option || '-').toUpperCase()}</small>
                                    </span>
                                </button>
                            ))}
                            {questions.length === 0 && <div className="empty-state">Belum ada soal pada ujian ini.</div>}
                        </div>
                    </div>

                    <form className="question-editor" onSubmit={saveQuestion}>
                        <div className="editor-head">
                            <div>
                                <h3>{editingQuestion ? 'Edit Soal' : 'Tambah Soal'}</h3>
                                <p className="muted">{editingQuestion ? `ID soal ${editingQuestion.id}` : 'Soal baru akan masuk ke paket A/B/C otomatis.'}</p>
                            </div>
                            <button className="btn primary" disabled={!selectedExam || busy === 'question'}><Plus size={17} /> {editingQuestion ? 'Simpan' : 'Tambah'}</button>
                        </div>

                        <div className="question-form-grid">
                            <div className="field">
                                <label>Minggu</label>
                                <input type="number" min="1" max="16" value={questionForm.week} onChange={(event) => setQuestionForm({ ...questionForm, week: event.target.value })} />
                            </div>
                            <div className="field">
                                <label>Kunci</label>
                                <select value={questionForm.correct_option} onChange={(event) => setQuestionForm({ ...questionForm, correct_option: event.target.value })}>
                                    <option value="a">A</option>
                                    <option value="b">B</option>
                                    <option value="c">C</option>
                                    <option value="d">D</option>
                                </select>
                            </div>
                        </div>

                        <div className="field">
                            <label>Pertanyaan</label>
                            <textarea rows="4" value={questionForm.question_text} onChange={(event) => setQuestionForm({ ...questionForm, question_text: event.target.value })} required />
                        </div>

                        {['a', 'b', 'c', 'd'].map((option) => (
                            <div className="field" key={option}>
                                <label>Opsi {option.toUpperCase()}</label>
                                <textarea rows="2" value={questionForm[`option_${option}`]} onChange={(event) => setQuestionForm({ ...questionForm, [`option_${option}`]: event.target.value })} required />
                            </div>
                        ))}

                        <div className="field">
                            <label>Pembahasan</label>
                            <textarea rows="3" value={questionForm.explanation} onChange={(event) => setQuestionForm({ ...questionForm, explanation: event.target.value })} />
                        </div>

                        <div className="action-row">
                            <button className="btn primary" disabled={!selectedExam || busy === 'question'}><Plus size={17} /> {editingQuestion ? 'Simpan Perubahan' : 'Tambah Soal'}</button>
                            <button type="button" className="btn secondary" onClick={clearQuestionForm}><X size={17} /> Kosongkan</button>
                            {editingQuestion && (
                                <button type="button" className="btn danger" disabled={busy === 'question'} onClick={() => deleteQuestion(editingQuestion)}><Trash2 size={17} /> Hapus</button>
                            )}
                        </div>
                    </form>
                </div>
            </section>

            <section className="panel">
                <div className="section-head">
                    <div>
                        <h2>Attempt Terbaru</h2>
                        <p className="muted">Menampilkan 12 attempt terakhir dari mahasiswa.</p>
                    </div>
                    <button className="btn secondary" onClick={loadAttempts}>Refresh</button>
                </div>
                <div className="table-wrap">
                    <table>
                        <thead><tr><th>Nama</th><th>NRP</th><th>Ujian</th><th>Paket</th><th>Status</th><th>Skor</th><th>Grade</th></tr></thead>
                        <tbody>
                            {latestAttempts.map((attempt) => (
                                <tr key={attempt.id}>
                                    <td>{attempt.user.name}</td>
                                    <td>{attempt.user.nrp}</td>
                                    <td>{attempt.exam.title}</td>
                                    <td>{attempt.package?.code || '-'}</td>
                                    <td><span className={`status-pill mini ${attempt.status === 'submitted' ? 'open' : attempt.status === 'in_progress' ? 'scheduled' : 'closed'}`}>{attempt.status}</span></td>
                                    <td>{attempt.score}/{attempt.total_questions}</td>
                                    <td>{attempt.letter_grade || '-'}</td>
                                </tr>
                            ))}
                            {latestAttempts.length === 0 && <tr><td colSpan="7">Belum ada attempt mahasiswa.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}

createRoot(document.getElementById('root')).render(<App />);
