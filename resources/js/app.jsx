import './bootstrap';
import '../css/app.css';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BarChart3, BookOpen, CalendarClock, Camera, CameraOff, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, Clock, Database, FileUp, LayoutDashboard, LogOut, Pencil, Plus, Power, RotateCcw, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

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

const PROCTOR_ABSENCE_LIMIT_SECONDS = 10;
const PROCTOR_WARNING_LIMIT = 5;
const PROCTOR_DETECTION_INTERVAL_MS = 2000;
const MEDIAPIPE_WASM_PATH = '/vendor/mediapipe/wasm';
const MEDIAPIPE_FACE_MODEL_PATH = '/vendor/mediapipe/models/blaze_face_short_range.tflite';

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
                    <Route path="/admin/master" element={<Private user={user} role="admin"><AdminMaster /></Private>} />
                    <Route path="/admin/grading" element={<Private user={user} role="admin"><AdminGrading /></Private>} />
                    <Route path="/admin/students" element={<Private user={user} role="admin"><AdminStudents /></Private>} />
                    <Route path="/admin/report" element={<Private user={user} role="admin"><AdminReport /></Private>} />
                    <Route path="/admin/import" element={<Private user={user} role="admin"><AdminImport /></Private>} />
                    <Route path="*" element={<Navigate to={user ? (user.role === 'admin' ? '/admin/import' : '/courses') : '/login'} />} />
                </Routes>
            </Shell>
        </BrowserRouter>
    );
}

function Shell({ children, user, setUser }) {
    const navigate = useNavigate();
    const location = useLocation();
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
                        {user.role === 'admin' && <AdminNav />}
                        {user.role === 'student' && <Link className="btn secondary" to="/courses">Mata Kuliah</Link>}
                        <button className="btn secondary" onClick={logout}><LogOut size={17} /> Keluar</button>
                    </div>
                )}
            </header>
            <main className={`container ${user?.role === 'admin' ? 'admin-container' : ''} ${location.pathname.startsWith('/attempt/') ? 'attempt-container' : ''}`}>{children}</main>
        </div>
    );
}

function AdminNav() {
    const location = useLocation();
    const items = [
        { to: '/admin/import', label: 'Console', icon: LayoutDashboard },
        { to: '/admin/grading', label: 'Nilai', icon: Pencil },
        { to: '/admin/master', label: 'Master Data', icon: Database },
        { to: '/admin/students', label: 'Mahasiswa', icon: Users },
        { to: '/admin/report', label: 'Report', icon: BarChart3 },
    ];

    return (
        <nav className="admin-nav" aria-label="Menu admin">
            {items.map((item) => {
                const Icon = item.icon;
                const active = location.pathname === item.to;

                return (
                    <Link key={item.to} className={`admin-nav-link ${active ? 'active' : ''}`} to={item.to}>
                        <Icon size={16} /> {item.label}
                    </Link>
                );
            })}
        </nav>
    );
}

function AdminStudents() {
    const emptyForm = { nrp: '', name: '', email: '', class_name: '', password: '' };
    const [students, setStudents] = useState([]);
    const [classes, setClasses] = useState([]);
    const [loaded, setLoaded] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [filter, setFilter] = useState('');
    const [classFilter, setClassFilter] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [page, setPage] = useState(1);
    const pageSize = 20;

    const loadStudents = () => {
        setError('');
        return api.get('/api/admin/students')
            .then((data) => {
                setStudents(data.students || []);
                setClasses(data.classes || []);
                setLoaded(true);
            })
            .catch((err) => setError(err.message));
    };

    useEffect(() => {
        loadStudents();
    }, []);

    const startEdit = (student) => {
        setEditingId(student.id);
        setForm({
            nrp: student.nrp || '',
            name: student.name || '',
            email: student.email || '',
            class_name: student.class_name || '',
            password: '',
        });
        setMessage('');
        setError('');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setForm(emptyForm);
    };

    const submitForm = async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage('');
        setError('');
        try {
            const payload = {
                nrp: form.nrp.trim(),
                name: form.name.trim(),
                email: form.email.trim() || null,
                class_name: form.class_name.trim() || null,
            };
            if (form.password.trim()) payload.password = form.password.trim();

            if (editingId) {
                await api.post(`/api/admin/students/${editingId}`, payload);
                setMessage('Mahasiswa berhasil diperbarui.');
            } else {
                await api.post('/api/admin/students', payload);
                setMessage('Mahasiswa berhasil ditambahkan.');
            }
            cancelEdit();
            await loadStudents();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const deleteStudent = async (student) => {
        if (!confirm(`Hapus mahasiswa ${student.name} (${student.nrp})? Tindakan ini tidak bisa dibatalkan.`)) return;
        setMessage('');
        setError('');
        try {
            await api.delete(`/api/admin/students/${student.id}`);
            if (editingId === student.id) cancelEdit();
            setMessage('Mahasiswa berhasil dihapus.');
            await loadStudents();
        } catch (err) {
            setError(err.message);
        }
    };

    const filtered = useMemo(() => {
        const keyword = filter.trim().toLowerCase();
        return students.filter((student) => {
            if (classFilter && (student.class_name || '') !== classFilter) return false;
            if (!keyword) return true;
            return [student.name, student.nrp, student.email, student.class_name]
                .some((value) => String(value || '').toLowerCase().includes(keyword));
        });
    }, [students, filter, classFilter]);

    useEffect(() => { setPage(1); }, [filter, classFilter]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const pageSafe = Math.min(page, totalPages);
    const paged = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

    return (
        <div className="admin-students">
            <section className="admin-titlebar">
                <div>
                    <h1>Kelola Mahasiswa</h1>
                    <p className="muted">Tambah, ubah, dan hapus akun mahasiswa. Password default = NRP.</p>
                </div>
            </section>

            {message && <div className="alert">{message}</div>}
            {error && <div className="alert error">{error}</div>}

            <div className="master-grid">
                <section className="panel master-create">
                    <div className="compact-head">
                        <h2>{editingId ? 'Edit Mahasiswa' : 'Tambah Mahasiswa'}</h2>
                        <span>{editingId ? 'Edit' : 'Baru'}</span>
                    </div>
                    <form onSubmit={submitForm}>
                        <div className="field">
                            <label>NRP</label>
                            <input value={form.nrp} onChange={(event) => setForm({ ...form, nrp: event.target.value })} placeholder="5123500001" maxLength={10} required />
                        </div>
                        <div className="field">
                            <label>Nama</label>
                            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nama lengkap" required />
                        </div>
                        <div className="field">
                            <label>Kelas</label>
                            <input list="admin-class-options" value={form.class_name} onChange={(event) => setForm({ ...form, class_name: event.target.value })} placeholder="Contoh: 3 MMB A" />
                            <datalist id="admin-class-options">
                                {classes.map((name) => <option key={name} value={name} />)}
                            </datalist>
                        </div>
                        <div className="field">
                            <label>Email <span className="muted">(opsional)</span></label>
                            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="opsional" />
                        </div>
                        <div className="field">
                            <label>Password <span className="muted">{editingId ? '(kosongkan = tidak diubah)' : '(kosongkan = sama dengan NRP)'}</span></label>
                            <input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={editingId ? 'Reset password (opsional)' : 'Default: NRP'} />
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button className="btn primary" disabled={busy}>
                                {editingId ? <><Check size={17} /> Simpan Perubahan</> : <><Plus size={17} /> Tambah Mahasiswa</>}
                            </button>
                            {editingId && <button type="button" className="btn secondary" onClick={cancelEdit}><X size={17} /> Batal</button>}
                        </div>
                    </form>
                </section>

                <section className="panel">
                    <div className="section-head">
                        <div>
                            <h2>Daftar Mahasiswa</h2>
                            <p className="muted">{filtered.length} dari {students.length} mahasiswa tampil.</p>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
                                <option value="">Semua kelas</option>
                                {classes.map((name) => <option key={name} value={name}>{name}</option>)}
                            </select>
                            <input className="search-input" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Cari nama, NRP, kelas..." />
                        </div>
                    </div>
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>NRP</th>
                                    <th>Nama</th>
                                    <th>Kelas</th>
                                    <th>Email</th>
                                    <th>Status</th>
                                    <th>Ujian</th>
                                    <th>Aksi</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paged.map((student) => (
                                    <tr key={student.id} className={editingId === student.id ? 'active' : ''}>
                                        <td>{student.nrp || '-'}</td>
                                        <td>{student.name}</td>
                                        <td>{student.class_name || '-'}</td>
                                        <td>{student.email || '-'}</td>
                                        <td><span className={`status-pill mini ${student.has_logged_in ? 'open' : 'closed'}`}>{student.has_logged_in ? 'Sudah login' : 'Belum'}</span></td>
                                        <td>{student.attempts_count}</td>
                                        <td>
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                <button className="btn secondary mini" onClick={() => startEdit(student)}><Pencil size={15} /> Edit</button>
                                                <button className="btn danger mini" onClick={() => deleteStudent(student)}><Trash2 size={15} /> Hapus</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {loaded && filtered.length === 0 && <tr><td colSpan="7">Mahasiswa tidak ditemukan.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                    {totalPages > 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                            <button className="btn secondary mini" disabled={pageSafe <= 1} onClick={() => setPage(pageSafe - 1)}><ChevronLeft size={15} /> Sebelumnya</button>
                            <span className="muted">Halaman {pageSafe} / {totalPages}</span>
                            <button className="btn secondary mini" disabled={pageSafe >= totalPages} onClick={() => setPage(pageSafe + 1)}>Berikutnya <ChevronRight size={15} /></button>
                        </div>
                    )}
                </section>
            </div>
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
            navigate(data.user.role === 'admin' ? '/admin/import' : '/courses');
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

    return (
        <div className="grid">
            <section className="panel">
                <h1>Pilih Mata Kuliah</h1>
                <p className="muted">
                    {user?.class_name ? `Kelas ${user.class_name}` : 'Pilih ujian yang akan dikerjakan.'}
                </p>
                {error && <div className="alert error">{error}</div>}
                {!error && courses.length === 0 && <div className="alert">Belum ada mata kuliah aktif untuk kelas ini.</div>}
                <div className="course-grid">
                    {courses.map((course) => (
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

    const start = async (examItem) => {
        setBusy(examItem.id);
        setError('');
        try {
            const result = await api.post(`/api/exams/${examItem.id}/start`);
            navigate(`/attempt/${result.attempt.id}`);
        } catch (err) {
            if (err.message.includes('Attempt') && examItem.attempt) navigate(`/attempt/${examItem.attempt.id}`);
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    if (error && !data) return <div className="alert error">{error}</div>;
    if (!data) return <div>Memuat ujian...</div>;

    const examItems = data.exams?.length
        ? data.exams
        : data.exam
            ? [{ ...data.exam, attempt: data.attempt }]
            : [];
    const courseName = examItems[0]?.course?.name;

    return (
        <div className="grid">
            <section className="panel">
                <div className="section-head">
                    <div>
                        <h1>{courseName || 'Ujian Aktif'}</h1>
                        <p className="muted">Pilih ujian aktif yang akan dikerjakan. Setiap ujian punya attempt dan timer masing-masing.</p>
                    </div>
                    <button className="btn secondary" onClick={() => navigate('/courses')}>Ganti Mata Kuliah</button>
                </div>
                {error && <div className="alert error">{error}</div>}
                <div className="exam-choice-grid">
                    {examItems.map((examItem) => {
                        const hasQuestions = examItem.question_count > 0;
                        const submitted = examItem.attempt && examItem.attempt.status !== 'in_progress';

                        return (
                            <article className="exam-choice-card" key={examItem.id}>
                                <div>
                                    <h2>{examItem.title}</h2>
                                    <p className="muted">Durasi {examItem.duration_minutes} menit sejak Start ditekan.</p>
                                </div>
                                {!hasQuestions && <div className="alert">Soal belum diimport untuk kelas ini.</div>}
                                <div className="exam-choice-stats">
                                    <div className="stat-row"><span>Jumlah soal</span><strong>{examItem.question_count}</strong></div>
                                    <div className="stat-row"><span>Status</span><strong>{examItem.attempt?.status || 'belum mulai'}</strong></div>
                                    <div className="stat-row"><span>Paket</span><strong>{examItem.package_count || 0}</strong></div>
                                </div>
                                <div className="action-row">
                                    {examItem.attempt && !submitted && <button className="btn primary" onClick={() => navigate(`/attempt/${examItem.attempt.id}`)}>Lanjutkan Attempt</button>}
                                    {submitted && <button className="btn primary" onClick={() => navigate(`/result/${examItem.attempt.id}`)}>Lihat Hasil</button>}
                                    {!examItem.attempt && <button className="btn primary" disabled={!hasQuestions || busy === examItem.id} onClick={() => start(examItem)}>{busy === examItem.id ? 'Start...' : 'Start'}</button>}
                                </div>
                            </article>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}

function AttemptPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const personDetectorRef = useRef(null);
    const personDetectorPromiseRef = useRef(null);
    const absenceStartedAtRef = useRef(null);
    const warningSlotRef = useRef(0);
    const warningCountRef = useRef(0);
    const violationRef = useRef(false);
    const [attempt, setAttempt] = useState(null);
    const [current, setCurrent] = useState(0);
    const [saving, setSaving] = useState('');
    const [error, setError] = useState('');
    const [now, setNow] = useState(Date.now());
    const [submitting, setSubmitting] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [cameraStatus, setCameraStatus] = useState({ state: 'checking', message: 'Memeriksa kamera...' });
    const [cameraBusy, setCameraBusy] = useState(false);
    const [proctorState, setProctorState] = useState({
        supported: false,
        personPresent: null,
        absenceSeconds: 0,
        warningCount: 0,
        violation: false,
        message: 'Rule person menunggu kamera aktif.',
    });

    const stopCamera = () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
    };

    const setCameraOff = (message) => {
        setCameraStatus({ state: 'off', message });
        absenceStartedAtRef.current = null;
        warningSlotRef.current = 0;
        setProctorState((current) => ({
            ...current,
            personPresent: null,
            absenceSeconds: 0,
            message: 'Rule person berhenti sampai kamera aktif lagi.',
        }));
    };

    const recordProctorEvent = async (type, absenceSeconds, warningCount, message) => {
        try {
            const data = await api.post(`/api/attempts/${id}/proctor-event`, {
                type,
                absence_seconds: absenceSeconds,
                warning_count: warningCount,
                message,
            });
            setAttempt((currentAttempt) => currentAttempt
                ? {
                    ...currentAttempt,
                    proctor_warnings: data.attempt?.proctor_warnings ?? warningCount,
                    proctor_violation: data.attempt?.proctor_violation ?? type === 'camera_absence_violation',
                    proctor_events: data.attempt?.proctor_events ?? currentAttempt.proctor_events,
                }
                : currentAttempt
            );
        } catch {
            // Proctoring UI tetap berjalan walau sinkronisasi event sesaat gagal.
        }
    };

    const startCamera = async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
            setCameraStatus({ state: 'unsupported', message: 'Browser ini belum mendukung akses kamera.' });
            return;
        }

        setCameraBusy(true);
        setCameraStatus({ state: 'checking', message: 'Meminta akses kamera...' });

        try {
            stopCamera();
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
            const [track] = stream.getVideoTracks();

            if (!track) {
                stream.getTracks().forEach((item) => item.stop());
                setCameraStatus({ state: 'missing', message: 'Kamera tidak ditemukan di perangkat ini.' });
                return;
            }

            track.onended = () => setCameraOff('Kamera berhenti. Nyalakan lagi untuk melanjutkan ujian.');
            track.onmute = () => setCameraOff('Kamera tidak aktif. Periksa perangkat lalu nyalakan lagi.');
            track.onunmute = () => setCameraStatus({ state: 'ready', message: 'Kamera aktif.' });

            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play?.().catch(() => {});
            }
            setCameraStatus({ state: 'ready', message: 'Kamera aktif.' });
        } catch (err) {
            if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
                setCameraStatus({ state: 'blocked', message: 'Akses kamera ditolak. Izinkan kamera di browser untuk mengerjakan ujian.' });
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                setCameraStatus({ state: 'missing', message: 'Kamera tidak ditemukan di perangkat ini.' });
            } else {
                setCameraStatus({ state: 'off', message: 'Kamera belum bisa dinyalakan. Periksa kamera lalu coba lagi.' });
            }
        } finally {
            setCameraBusy(false);
        }
    };

    useEffect(() => {
        api.get(`/api/attempts/${id}`).then((data) => setAttempt(data.attempt)).catch((err) => setError(err.message));
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, [id]);

    useEffect(() => {
        if (!attempt) return undefined;
        const assignment = (attempt.answers || []).length > 0
            && attempt.answers.every((answer) => answer.question?.question_type === 'file_upload');
        if (assignment) return undefined;
        startCamera();
        return () => stopCamera();
    }, [attempt?.id]);

    useEffect(() => {
        if (videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
            videoRef.current.srcObject = streamRef.current;
            videoRef.current.play?.().catch(() => {});
        }
    }, [attempt, cameraStatus.state]);

    useEffect(() => {
        if (!attempt) return;
        warningCountRef.current = Math.max(warningCountRef.current, Number(attempt.proctor_warnings || 0));
        violationRef.current = violationRef.current || Boolean(attempt.proctor_violation);
        setProctorState((current) => ({
            ...current,
            warningCount: warningCountRef.current,
            violation: violationRef.current,
        }));
    }, [attempt?.id, attempt?.proctor_warnings, attempt?.proctor_violation]);

    const answers = attempt?.answers || [];
    const active = answers[current];
    const isAssignment = answers.length > 0 && answers.every((answer) => answer.question?.question_type === 'file_upload');
    const multipleChoiceAnswers = answers.filter((answer) => !['true_false', 'hots'].includes(answer.question?.question_type));
    const trueFalseAnswers = answers.filter((answer) => answer.question?.question_type === 'true_false');
    const hotsAnswers = answers.filter((answer) => answer.question?.question_type === 'hots');
    const activePhase = active?.question?.question_type === 'true_false'
        ? 'true_false'
        : active?.question?.question_type === 'hots'
            ? 'hots'
            : 'multiple_choice';
    const phaseAnswers = activePhase === 'true_false'
        ? trueFalseAnswers
        : activePhase === 'hots'
            ? hotsAnswers
            : multipleChoiceAnswers;
    const phaseTitle = activePhase === 'true_false' ? 'Tahap True/False' : activePhase === 'hots' ? 'Tahap HOTS' : 'Tahap ABCD';
    const phaseIndex = phaseAnswers.findIndex((answer) => answer.id === active?.id);
    const multipleChoiceComplete = multipleChoiceAnswers.every(answerIsFilled);
    const firstTrueFalseIndex = answers.findIndex((answer) => answer.question?.question_type === 'true_false');
    const firstHotsIndex = answers.findIndex((answer) => answer.question?.question_type === 'hots');
    const firstMultipleChoiceIndex = answers.findIndex((answer) => !['true_false', 'hots'].includes(answer.question?.question_type));
    const remaining = useMemo(() => attempt ? Math.max(0, new Date(attempt.ends_at).getTime() - now) : 0, [attempt, now]);
    const warning = remaining <= 5 * 60 * 1000;
    const cameraReady = cameraStatus.state === 'ready';
    const cameraRequired = attempt?.status === 'in_progress' && !isAssignment;
    const cameraLocked = cameraRequired && !cameraReady;
    const cameraLabel = cameraReady ? 'Aktif' : cameraStatus.state === 'checking' ? 'Cek' : 'Wajib';

    const ensureCameraReady = () => {
        if (!cameraLocked) return true;
        setCameraStatus((currentStatus) => ({
            ...currentStatus,
            message: currentStatus.message || 'Kamera wajib aktif untuk mengerjakan ujian.',
        }));
        return false;
    };

    useEffect(() => {
        if (!cameraReady || attempt?.status !== 'in_progress') {
            absenceStartedAtRef.current = null;
            warningSlotRef.current = 0;
            setProctorState((current) => ({
                ...current,
                personPresent: null,
                absenceSeconds: 0,
                message: cameraReady ? 'Rule person berhenti karena attempt tidak berjalan.' : 'Rule person menunggu kamera aktif.',
            }));
            return undefined;
        }

        let cancelled = false;
        let detectorInterval = null;

        const updatePersonState = (personPresent) => {
            if (cancelled) return;

            if (personPresent) {
                absenceStartedAtRef.current = null;
                warningSlotRef.current = 0;
                setProctorState((current) => ({
                    ...current,
                    supported: true,
                    personPresent: true,
                    absenceSeconds: 0,
                    message: violationRef.current
                        ? 'Person terdeteksi, tetapi attempt sudah memiliki indikasi pelanggaran.'
                        : 'Person terdeteksi.',
                }));
                return;
            }

            const startedAt = absenceStartedAtRef.current || Date.now();
            absenceStartedAtRef.current = startedAt;
            const absenceSeconds = Math.floor((Date.now() - startedAt) / 1000);
            const warningSlot = Math.floor(absenceSeconds / PROCTOR_ABSENCE_LIMIT_SECONDS);
            let message = `Person tidak terdeteksi ${absenceSeconds}/${PROCTOR_ABSENCE_LIMIT_SECONDS} detik.`;

            if (warningSlot >= 1 && warningSlot !== warningSlotRef.current) {
                warningSlotRef.current = warningSlot;
                warningCountRef.current += 1;

                if (warningCountRef.current > PROCTOR_WARNING_LIMIT) {
                    violationRef.current = true;
                    message = 'Indikasi pelanggaran: person tidak terdeteksi lebih dari 5 peringatan.';
                    recordProctorEvent('camera_absence_violation', absenceSeconds, warningCountRef.current, message);
                } else {
                    message = `Peringatan ${warningCountRef.current}/${PROCTOR_WARNING_LIMIT}: mendekat ke kamera/sistem.`;
                    recordProctorEvent('camera_absence_warning', absenceSeconds, warningCountRef.current, message);
                }
            }

            setProctorState((current) => ({
                ...current,
                supported: true,
                personPresent: false,
                absenceSeconds,
                warningCount: warningCountRef.current,
                violation: violationRef.current,
                message,
            }));
        };

        const loadPersonDetector = async () => {
            if (personDetectorRef.current) return personDetectorRef.current;

            if (!personDetectorPromiseRef.current) {
                setProctorState((current) => ({
                    ...current,
                    supported: false,
                    personPresent: null,
                    absenceSeconds: 0,
                    message: 'Memuat MediaPipe Face Detection...',
                }));

                personDetectorPromiseRef.current = FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_PATH)
                    .then((vision) => FaceDetector.createFromOptions(vision, {
                        baseOptions: {
                            modelAssetPath: MEDIAPIPE_FACE_MODEL_PATH,
                        },
                        runningMode: 'VIDEO',
                        minDetectionConfidence: 0.5,
                    }));
            }

            personDetectorRef.current = await personDetectorPromiseRef.current;
            return personDetectorRef.current;
        };

        const detectPerson = async () => {
            const video = videoRef.current;
            if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

            try {
                const detector = await loadPersonDetector();
                const result = detector.detectForVideo(video, performance.now());
                updatePersonState((result?.detections || []).length > 0);
            } catch {
                personDetectorPromiseRef.current = null;
                setProctorState((current) => ({
                    ...current,
                    supported: false,
                    personPresent: null,
                    absenceSeconds: 0,
                    message: 'MediaPipe Face Detection belum bisa dimuat. Kamera tetap wajib aktif.',
                }));
            }
        };

        detectPerson();
        detectorInterval = setInterval(detectPerson, PROCTOR_DETECTION_INTERVAL_MS);

        return () => {
            cancelled = true;
            if (detectorInterval) clearInterval(detectorInterval);
        };
    }, [cameraReady, attempt?.status, id]);

    useEffect(() => {
        if (attempt && remaining === 0 && attempt.status === 'in_progress') {
            submit(true);
        }
    }, [remaining, attempt]);

    const setAnswerState = (answerId, patch) => {
        setAttempt((currentAttempt) => ({
            ...currentAttempt,
            answers: currentAttempt.answers.map((item) => item.id === answerId ? { ...item, ...patch } : item),
        }));
    };

    const goToPhase = (phase) => {
        if (phase === 'true_false' && firstTrueFalseIndex < 0) return;
        if (phase === 'hots' && firstHotsIndex < 0) return;
        if (phase === 'multiple_choice' && firstMultipleChoiceIndex >= 0) setCurrent(firstMultipleChoiceIndex);
        if (phase === 'true_false') setCurrent(firstTrueFalseIndex);
        if (phase === 'hots') setCurrent(firstHotsIndex);
    };

    const choose = async (option) => {
        if (!active || attempt.status !== 'in_progress') return;
        if (!ensureCameraReady()) return;
        setAnswerState(active.id, { selected_option: option, selected_options: null });
        setSaving('Menyimpan...');
        try {
            await api.post(`/api/attempts/${id}/answer`, { question_id: active.question_id, selected_option: option });
            setSaving('Saved');
            const nextAnswers = answers.map((item) => item.id === active.id ? { ...item, selected_option: option, selected_options: null } : item);
            const nextMultipleChoiceComplete = nextAnswers
                .filter((answer) => !['true_false', 'hots'].includes(answer.question?.question_type))
                .every(answerIsFilled);
            if (nextMultipleChoiceComplete && activePhase === 'multiple_choice' && phaseIndex === multipleChoiceAnswers.length - 1 && firstTrueFalseIndex >= 0) {
                setCurrent(firstTrueFalseIndex);
            } else if (nextMultipleChoiceComplete && activePhase === 'multiple_choice' && phaseIndex === multipleChoiceAnswers.length - 1 && firstHotsIndex >= 0) {
                setCurrent(firstHotsIndex);
            }
        } catch (err) {
            setError(err.message);
        }
    };

    const chooseTrueFalse = async (key, value) => {
        if (!active || attempt.status !== 'in_progress') return;
        if (!ensureCameraReady()) return;
        const selectedOptions = { ...(active.selected_options || {}), [key]: value };
        setAnswerState(active.id, { selected_option: null, selected_options: selectedOptions });
        setSaving('Menyimpan...');
        try {
            await api.post(`/api/attempts/${id}/answer`, { question_id: active.question_id, selected_options: selectedOptions });
            setSaving('Saved');
        } catch (err) {
            setError(err.message);
        }
    };

    const saveHotsAnswer = async () => {
        if (!active || attempt.status !== 'in_progress') return;
        if (!ensureCameraReady()) return;
        setSaving('Menyimpan...');
        try {
            await api.post(`/api/attempts/${id}/answer`, { question_id: active.question_id, essay_answer: active.essay_answer || '' });
            setSaving('Saved');
        } catch (err) {
            setError(err.message);
        }
    };

    const uploadTugas = async (answer, file) => {
        if (!file || !answer || attempt.status !== 'in_progress') return;
        if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
            setError('Berkas tugas harus berformat PDF.');
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            setError('Ukuran berkas melebihi 10 MB.');
            return;
        }
        setUploading(true);
        setError('');
        setSaving('Mengunggah...');
        try {
            const body = new FormData();
            body.append('question_id', answer.question_id);
            body.append('file', file);
            const data = await api.post(`/api/attempts/${id}/upload`, body);
            setAnswerState(answer.id, {
                file_path: data.answer.file_path,
                file_original_name: data.answer.file_original_name,
                file_size: data.answer.file_size,
            });
            setSaving('Saved');
        } catch (err) {
            setError(err.message);
            setSaving('');
        } finally {
            setUploading(false);
        }
    };

    const submit = async (auto = false) => {
        if (!auto && !ensureCameraReady()) return;
        const unanswered = answers.filter((answer) => !answerIsFilled(answer)).length;
        const message = unanswered > 0
            ? `Masih ada ${unanswered} soal belum lengkap. Submit ujian sekarang?`
            : 'Submit ujian sekarang?';
        if (!auto && !confirm(message)) return;
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

    if (isAssignment) {
        const closed = attempt.status !== 'in_progress' || remaining === 0;
        const allUploaded = answers.every((answer) => Boolean(answer.file_path));
        return (
            <div className="exam-layout assignment-layout" style={{ display: 'block', maxWidth: 760, margin: '0 auto' }}>
                <section className="panel">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
                        <div>
                            <h2 style={{ margin: 0 }}>{attempt.exam?.title}</h2>
                            <p className="muted" style={{ margin: '6px 0 0' }}>Pengumpulan Tugas (PDF) | {attempt.exam?.course?.name || '-'}</p>
                        </div>
                        <span className={`status-pill ${closed ? 'closed' : 'open'}`}>{closed ? 'Ditutup' : 'Dibuka'}</span>
                    </div>
                    <p className="muted">Batas pengumpulan: <strong>{formatDateTime(attempt.ends_at)}</strong></p>
                    {error && <div className="alert error">{error}</div>}
                    {closed && <div className="alert">Masa pengumpulan sudah berakhir. Berkas tidak bisa diubah lagi.</div>}
                    {answers.map((answer, index) => (
                        <div key={answer.id} className="assignment-card" style={{ border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, padding: 16, marginTop: 14 }}>
                            {answers.length > 1 && <h3 style={{ marginTop: 0 }}>Tugas {index + 1}</h3>}
                            <p className="question-text">{answer.question?.question_text}</p>
                            {answer.file_path ? (
                                <div className="alert" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Check size={16} /> Terkumpul: <strong>{answer.file_original_name}</strong>
                                    {answer.file_size ? <span className="muted">({Math.round(answer.file_size / 1024)} KB)</span> : null}
                                </div>
                            ) : (
                                <p className="muted">Belum ada berkas yang dikumpulkan.</p>
                            )}
                            {!closed && (
                                <label className="field" style={{ marginTop: 8 }}>
                                    <span>{answer.file_path ? 'Ganti berkas PDF' : 'Pilih berkas PDF (maks 10 MB)'}</span>
                                    <input
                                        className="file-input"
                                        type="file"
                                        accept="application/pdf,.pdf"
                                        disabled={uploading}
                                        onChange={(event) => {
                                            const file = event.target.files[0];
                                            event.target.value = '';
                                            uploadTugas(answer, file);
                                        }}
                                    />
                                </label>
                            )}
                        </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 18, alignItems: 'center' }}>
                        <span className="muted">{saving === 'Saved' ? <><Check size={14} /> Tersimpan</> : saving}</span>
                        {attempt.status === 'in_progress'
                            ? <button className="btn primary" disabled={submitting || uploading} onClick={() => submit(false)}>{allUploaded ? 'Kumpulkan & Selesai' : 'Selesai (sebagian belum diunggah)'}</button>
                            : <button className="btn secondary" onClick={() => navigate(`/result/${id}`)}>Lihat Status</button>}
                    </div>
                </section>
            </div>
        );
    }

    const mm = String(Math.floor(remaining / 60000)).padStart(2, '0');
    const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
    const currentNumber = phaseIndex >= 0 ? phaseIndex + 1 : current + 1;
    const proctorCountdown = proctorState.personPresent === false
        ? Math.max(0, PROCTOR_ABSENCE_LIMIT_SECONDS - (proctorState.absenceSeconds % PROCTOR_ABSENCE_LIMIT_SECONDS || PROCTOR_ABSENCE_LIMIT_SECONDS))
        : PROCTOR_ABSENCE_LIMIT_SECONDS;
    const proctorPersonLabel = !cameraReady
        ? 'Menunggu kamera'
        : proctorState.supported
            ? (proctorState.personPresent === false ? 'Tidak terdeteksi' : 'Terdeteksi')
            : 'MediaPipe';
    const nextInPhase = () => {
        if (phaseIndex < phaseAnswers.length - 1) {
            setCurrent(answers.findIndex((answer) => answer.id === phaseAnswers[phaseIndex + 1].id));
            return;
        }

        if (activePhase === 'multiple_choice' && firstTrueFalseIndex >= 0) {
            setCurrent(firstTrueFalseIndex);
            return;
        }

        if ((activePhase === 'multiple_choice' || activePhase === 'true_false') && firstHotsIndex >= 0) {
            setCurrent(firstHotsIndex);
        }
    };

    return (
        <div className="exam-layout">
            <aside className="panel attempt-side attempt-camera-panel">
                <div className={`camera-card ${cameraReady ? 'ready' : 'locked'}`}>
                    <div className="camera-head">
                        <strong><Camera size={17} /> Kamera Ujian</strong>
                        <span className={`camera-pill ${cameraReady ? 'ready' : 'locked'}`}>{cameraLabel}</span>
                    </div>
                    <div className="camera-preview">
                        <video ref={videoRef} autoPlay muted playsInline />
                        {!cameraReady && (
                            <div className="camera-placeholder">
                                <CameraOff size={26} />
                                <span>Kamera belum aktif</span>
                            </div>
                        )}
                    </div>
                    <p className="muted">{cameraStatus.message}</p>
                    <div className="proctor-rule-box">
                        <div className="stat-row"><span>Rule 1 person</span><strong>{proctorPersonLabel}</strong></div>
                        <div className="stat-row"><span>Counter absen</span><strong>{proctorState.absenceSeconds}/{PROCTOR_ABSENCE_LIMIT_SECONDS}s</strong></div>
                        <div className="stat-row"><span>Peringatan</span><strong>{proctorState.warningCount}/{PROCTOR_WARNING_LIMIT}</strong></div>
                        <div className="stat-row"><span>Status</span><strong>{proctorState.violation ? 'Pelanggaran' : 'Aman'}</strong></div>
                        <p className="muted">{proctorState.message}</p>
                    </div>
                    {!cameraReady && (
                        <button className="btn primary" style={{ width: '100%' }} disabled={cameraBusy} onClick={startCamera}>
                            {cameraBusy ? 'Menyalakan...' : 'Nyalakan Kamera'}
                        </button>
                    )}
                </div>
                <div className="stat-row"><span>Paket</span><strong>{attempt.package?.code || '-'}</strong></div>
                <div className="stat-row"><span>Pola acak</span><strong>{attempt.shuffle_pattern || '-'}/10</strong></div>
            </aside>
            <section className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
                    <div>
                        <h2 style={{ margin: 0 }}>{phaseTitle} {currentNumber}</h2>
                        <p className="muted" style={{ margin: '6px 0 0' }}>{questionTypeLabel(active.question?.question_type)} | Minggu {active.question?.week || '-'}</p>
                    </div>
                    <span className={`timer ${warning ? 'warn' : ''}`}><Clock size={17} /> {mm}:{ss}</span>
                </div>
                <div className="exam-tabs">
                    <button className={`exam-tab ${activePhase === 'multiple_choice' ? 'active' : ''}`} onClick={() => goToPhase('multiple_choice')}>
                        ABCD <span>{multipleChoiceAnswers.filter(answerIsFilled).length}/{multipleChoiceAnswers.length}</span>
                    </button>
                    <button className={`exam-tab ${activePhase === 'true_false' ? 'active' : ''}`} disabled={trueFalseAnswers.length === 0} onClick={() => goToPhase('true_false')}>
                        True/False <span>{trueFalseAnswers.filter(answerIsFilled).length}/{trueFalseAnswers.length}</span>
                    </button>
                    <button className={`exam-tab ${activePhase === 'hots' ? 'active' : ''}`} disabled={hotsAnswers.length === 0} onClick={() => goToPhase('hots')}>
                        HOTS <span>{hotsAnswers.filter(answerIsFilled).length}/{hotsAnswers.length}</span>
                    </button>
                </div>
                {warning && <div className="alert">Waktu kurang dari 5 menit.</div>}
                {cameraLocked && <div className="alert error">Kamera wajib aktif sebelum menjawab atau submit ujian.</div>}
                {cameraReady && proctorState.supported && proctorState.personPresent === false && !proctorState.violation && (
                    <div className="alert">Person tidak terdeteksi. Mendekat ke kamera sebelum peringatan berikutnya ({proctorCountdown} detik).</div>
                )}
                {proctorState.violation && (
                    <div className="alert error">Indikasi pelanggaran: person tidak terdeteksi lebih dari 5 peringatan.</div>
                )}
                {error && <div className="alert error">{error}</div>}
                {active.question?.image_url && (
                    <figure className="question-image-box">
                        <img src={active.question.image_url} alt={`Gambar soal ${currentNumber}`} />
                    </figure>
                )}
                <p className="question-text">{active.question.question_text}</p>
                {active.question?.question_type === 'true_false' ? (
                    <div className="tf-answer-list">
                        {questionKeys.map((key) => (
                            <div className="tf-answer-row" key={key}>
                                <span className="option-key">{key}</span>
                                <span>{active.question[`option_${key}`]}</span>
                                <div className="tf-toggle">
                                    <button disabled={cameraLocked} className={active.selected_options?.[key] === true ? 'selected' : ''} onClick={() => chooseTrueFalse(key, true)}>Benar</button>
                                    <button disabled={cameraLocked} className={active.selected_options?.[key] === false ? 'selected' : ''} onClick={() => chooseTrueFalse(key, false)}>Salah</button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : active.question?.question_type === 'hots' ? (
                    <div className="field hots-answer-box">
                        <label>Jawaban penjelasan</label>
                        <textarea
                            rows="10"
                            value={active.essay_answer || ''}
                            disabled={cameraLocked}
                            onChange={(event) => setAnswerState(active.id, { essay_answer: event.target.value })}
                            onBlur={saveHotsAnswer}
                            placeholder="Jelaskan analisis Anda berdasarkan gambar dan konteks soal."
                        />
                        <button className="btn secondary" disabled={cameraLocked} onClick={saveHotsAnswer}>Simpan Jawaban HOTS</button>
                    </div>
                ) : active.question?.question_type === 'file_upload' ? (
                    <div className="field">
                        <label>{active.file_path ? `Terkumpul: ${active.file_original_name}` : 'Unggah tugas (PDF, maks 10 MB)'}</label>
                        <input
                            className="file-input"
                            type="file"
                            accept="application/pdf,.pdf"
                            disabled={cameraLocked || uploading}
                            onChange={(event) => {
                                const file = event.target.files[0];
                                event.target.value = '';
                                uploadTugas(active, file);
                            }}
                        />
                    </div>
                ) : (
                    questionKeys.map((key) => (
                        <button key={key} disabled={cameraLocked} className={`option ${active.selected_option === key ? 'selected' : ''}`} onClick={() => choose(key)}>
                            <span className="option-key">{key}</span>
                            <span>{active.question[`option_${key}`]}</span>
                        </button>
                    ))
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 18 }}>
                    <button className="btn secondary" onClick={() => {
                        if (phaseIndex > 0) setCurrent(answers.findIndex((answer) => answer.id === phaseAnswers[phaseIndex - 1].id));
                    }}>Sebelumnya</button>
                    <span className="muted">{saving === 'Saved' ? <><Check size={14} /> Saved</> : saving}</span>
                    <button className="btn secondary" onClick={nextInPhase}>Berikutnya</button>
                </div>
            </section>
            <aside className="panel attempt-side attempt-nav-panel">
                <h3>Navigasi {questionTypeLabel(active.question?.question_type)}</h3>
                <div className="nav-grid">
                    {phaseAnswers.map((answer, index) => (
                        <button
                            key={answer.id}
                            className={`nav-cell ${answerIsFilled(answer) ? 'answered' : ''} ${active?.id === answer.id ? 'active' : ''}`}
                            onClick={() => setCurrent(answers.findIndex((item) => item.id === answer.id))}
                        >
                            {index + 1}
                        </button>
                    ))}
                </div>
                <div className="stat-row"><span>ABCD lengkap</span><strong>{multipleChoiceAnswers.filter(answerIsFilled).length}/{multipleChoiceAnswers.length}</strong></div>
                <div className="stat-row"><span>T/F lengkap</span><strong>{trueFalseAnswers.filter(answerIsFilled).length}/{trueFalseAnswers.length}</strong></div>
                <div className="stat-row"><span>HOTS lengkap</span><strong>{hotsAnswers.filter(answerIsFilled).length}/{hotsAnswers.length}</strong></div>
                <button className="btn danger" style={{ width: '100%', marginTop: 18 }} disabled={submitting || cameraLocked} onClick={() => submit(false)}>
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
                                <td>{answerDisplay(answer)}</td>
                                <td>{['hots', 'file_upload'].includes(answer.question?.question_type) ? (answer.manual_score != null ? `Nilai ${answer.manual_score}` : 'Perlu review') : answer.is_correct ? 'Benar' : 'Salah'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function AdminMaster() {
    const [data, setData] = useState(null);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [studentFilter, setStudentFilter] = useState('');
    const [courseForm, setCourseForm] = useState({ name: '', slug: '', is_active: true });

    const loadMaster = () => {
        setError('');

        return api.get('/api/admin/master-data')
            .then(setData)
            .catch((err) => setError(err.message));
    };

    useEffect(() => {
        loadMaster();
    }, []);

    const createCourse = async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage('');
        setError('');
        try {
            await api.post('/api/admin/courses', {
                name: courseForm.name,
                slug: courseForm.slug || null,
                is_active: courseForm.is_active,
            });
            setCourseForm({ name: '', slug: '', is_active: true });
            setMessage('Mata kuliah berhasil ditambahkan.');
            await loadMaster();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const summary = data?.summary || {};
    const summaryCards = [
        ['Mata Kuliah', summary.courses || 0, BookOpen],
        ['Ujian', summary.exams || 0, LayoutDashboard],
        ['Bank Soal', summary.questions || 0, Database],
        ['Mahasiswa', summary.students || 0, Users],
        ['Kelas', summary.classes || 0, Users],
        ['Attempt', summary.attempts || 0, BarChart3],
    ];
    const filteredStudents = useMemo(() => {
        const keyword = studentFilter.trim().toLowerCase();
        const students = data?.students || [];
        if (!keyword) return students;

        return students.filter((student) => [
            student.name,
            student.nrp,
            student.email,
            student.class_name,
        ].some((value) => String(value || '').toLowerCase().includes(keyword)));
    }, [data?.students, studentFilter]);

    return (
        <div className="admin-page">
            <section className="admin-titlebar">
                <div>
                    <h1>Master Data</h1>
                    <p className="muted">Pengelolaan data dasar dari database: mata kuliah, ujian, kelas, mahasiswa, paket, dan skala nilai.</p>
                </div>
                <button className="btn secondary" onClick={loadMaster}><RotateCcw size={17} /> Refresh</button>
            </section>

            {message && <div className="alert">{message}</div>}
            {error && <div className="alert error">{error}</div>}

            <section className="admin-overview" aria-label="Ringkasan master data">
                {summaryCards.map(([label, value, Icon]) => (
                    <div className="overview-item" key={label}>
                        <span><Icon size={15} /> {label}</span>
                        <strong>{Number(value || 0).toLocaleString('id-ID')}</strong>
                    </div>
                ))}
            </section>

            <div className="master-grid">
                <section className="panel master-create">
                    <div className="compact-head">
                        <h2>Tambah Mata Kuliah</h2>
                        <span>Master</span>
                    </div>
                    <form onSubmit={createCourse}>
                        <div className="field">
                            <label>Nama Mata Kuliah</label>
                            <input value={courseForm.name} onChange={(event) => setCourseForm({ ...courseForm, name: event.target.value })} placeholder="Contoh: Basis Data" required />
                        </div>
                        <div className="field">
                            <label>Slug</label>
                            <input value={courseForm.slug} onChange={(event) => setCourseForm({ ...courseForm, slug: event.target.value })} placeholder="basis-data" />
                        </div>
                        <label className="check-row">
                            <input type="checkbox" checked={courseForm.is_active} onChange={(event) => setCourseForm({ ...courseForm, is_active: event.target.checked })} />
                            Aktif untuk ujian
                        </label>
                        <button className="btn primary" disabled={busy}><Plus size={17} /> Simpan Mata Kuliah</button>
                    </form>
                </section>

                <section className="panel">
                    <div className="compact-head">
                        <h2>Mata Kuliah</h2>
                        <span>{data?.courses?.length || 0}</span>
                    </div>
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Nama</th>
                                    <th>Slug</th>
                                    <th>Status</th>
                                    <th>Ujian</th>
                                    <th>Skala Nilai</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(data?.courses || []).map((course) => (
                                    <tr key={course.id}>
                                        <td>{course.name}</td>
                                        <td>{course.slug}</td>
                                        <td><span className={`status-pill mini ${course.is_active ? 'open' : 'closed'}`}>{course.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
                                        <td>{course.exams_count}</td>
                                        <td>{course.grade_scales_count}</td>
                                    </tr>
                                ))}
                                {data && data.courses.length === 0 && <tr><td colSpan="5">Belum ada mata kuliah.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>

            <section className="panel">
                <div className="compact-head">
                    <h2>Ujian</h2>
                    <span>{data?.exams?.length || 0}</span>
                </div>
                <div className="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Ujian</th>
                                <th>Mata Kuliah</th>
                                <th>Status</th>
                                <th>Durasi</th>
                                <th>Masa Ujian</th>
                                <th>Soal</th>
                                <th>Paket</th>
                                <th>Attempt</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(data?.exams || []).map((exam) => {
                                const status = examStatus(exam);

                                return (
                                    <tr key={exam.id}>
                                        <td>{exam.title}</td>
                                        <td>{exam.course?.name || '-'}</td>
                                        <td><span className={`status-pill mini ${status.className}`}>{status.label}</span></td>
                                        <td>{exam.duration_minutes} menit</td>
                                        <td>{formatDateTime(exam.opens_at)} - {formatDateTime(exam.closes_at)}</td>
                                        <td>{exam.questions_count}</td>
                                        <td>{exam.packages_count}</td>
                                        <td>{exam.attempts_count}</td>
                                    </tr>
                                );
                            })}
                            {data && data.exams.length === 0 && <tr><td colSpan="8">Belum ada ujian.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </section>

            <div className="master-grid">
                <section className="panel">
                    <div className="compact-head">
                        <h2>Kelas</h2>
                        <span>{data?.classes?.length || 0}</span>
                    </div>
                    <div className="class-list">
                        {(data?.classes || []).map((item) => (
                            <div className="class-item" key={item.name}>
                                <strong>{item.name}</strong>
                                <span>{item.student_count} mahasiswa</span>
                            </div>
                        ))}
                        {data && data.classes.length === 0 && <div className="empty-state">Belum ada kelas.</div>}
                    </div>
                </section>

                <section className="panel">
                    <div className="section-head">
                        <div>
                            <h2>Mahasiswa</h2>
                            <p className="muted">{filteredStudents.length} dari {data?.students?.length || 0} mahasiswa tampil.</p>
                        </div>
                        <input className="search-input" value={studentFilter} onChange={(event) => setStudentFilter(event.target.value)} placeholder="Cari nama, NRP, kelas..." />
                    </div>
                    <div className="table-wrap master-student-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>NRP</th>
                                    <th>Nama</th>
                                    <th>Kelas</th>
                                    <th>Email</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredStudents.map((student) => (
                                    <tr key={student.id}>
                                        <td>{student.nrp || '-'}</td>
                                        <td>{student.name}</td>
                                        <td>{student.class_name || '-'}</td>
                                        <td>{student.email || '-'}</td>
                                    </tr>
                                ))}
                                {data && filteredStudents.length === 0 && <tr><td colSpan="4">Mahasiswa tidak ditemukan.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </div>
    );
}

function AdminReport() {
    const [report, setReport] = useState(null);
    const [filters, setFilters] = useState({ course_id: '', exam_id: '', class_name: '' });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [sort, setSort] = useState({ key: null, dir: 'asc' });
    const [qSort, setQSort] = useState({ key: null, dir: 'asc' });
    const [nSort, setNSort] = useState({ key: null, dir: 'asc' });
    const [tab, setTab] = useState('results');

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
    const notAttempted = report?.not_attempted || [];
    const questionAnalysis = report?.question_analysis || [];

    const studentColumns = [
        { key: 'name', label: 'Nama', type: 'text', value: (a) => a.student?.name },
        { key: 'nrp', label: 'NRP', type: 'text', value: (a) => a.student?.nrp },
        { key: 'class_name', label: 'Kelas', type: 'text', value: (a) => a.student?.class_name },
        { key: 'course', label: 'Mata Kuliah', type: 'text', value: (a) => a.course },
        { key: 'exam', label: 'Ujian', type: 'text', value: (a) => a.exam },
        { key: 'package', label: 'Paket', type: 'text', value: (a) => a.package },
        { key: 'shuffle_pattern', label: 'Pola', type: 'number', value: (a) => a.shuffle_pattern },
        { key: 'status', label: 'Status', type: 'text', value: (a) => a.status },
        { key: 'score', label: 'Skor', type: 'number', value: (a) => a.score },
        { key: 'percentage', label: 'Nilai', type: 'number', value: (a) => a.percentage },
        { key: 'letter_grade', label: 'Grade', type: 'text', value: (a) => a.letter_grade },
        { key: 'proctor_warnings', label: 'Warning', type: 'number', value: (a) => a.proctor_warnings },
        { key: 'proctor_violation', label: 'Proctor', type: 'number', value: (a) => (a.proctor_violation ? 1 : 0) },
    ];

    const toggleSort = (key) => {
        setSort((current) => (
            current.key === key
                ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
                : { key, dir: 'asc' }
        ));
    };

    const sortRows = (rows, columns, state) => {
        if (!state.key) return rows;
        const column = columns.find((col) => col.key === state.key);
        if (!column) return rows;
        const factor = state.dir === 'asc' ? 1 : -1;
        return [...rows].sort((a, b) => {
            const av = column.value(a);
            const bv = column.value(b);
            const aEmpty = av === null || av === undefined || av === '';
            const bEmpty = bv === null || bv === undefined || bv === '';
            if (aEmpty && bEmpty) return 0;
            if (aEmpty) return 1;
            if (bEmpty) return -1;
            if (column.type === 'number') return (Number(av) - Number(bv)) * factor;
            return String(av).localeCompare(String(bv), 'id-ID', { numeric: true, sensitivity: 'base' }) * factor;
        });
    };

    const sortedStudentResults = useMemo(
        () => sortRows(studentResults, studentColumns, sort),
        [studentResults, sort.key, sort.dir]
    );

    const questionColumns = [
        { key: 'number', label: 'No', type: 'number', value: (q) => q.number },
        { key: 'week', label: 'Minggu', type: 'number', value: (q) => q.week },
        { key: 'question_type', label: 'Jenis', type: 'text', value: (q) => questionTypeLabel(q.question_type) },
        { key: 'question_text', label: 'Soal', type: 'text', value: (q) => q.question_text },
        { key: 'answered_total', label: 'Dijawab', type: 'number', value: (q) => q.answered_total },
        { key: 'correct_total', label: 'Benar', type: 'number', value: (q) => q.correct_total },
        { key: 'wrong_total', label: 'Salah', type: 'number', value: (q) => q.wrong_total },
        { key: 'unanswered_total', label: 'Kosong', type: 'number', value: (q) => q.unanswered_total },
        { key: 'correct_rate', label: 'Akurasi', type: 'number', value: (q) => q.correct_rate },
    ];

    const toggleQSort = (key) => {
        setQSort((current) => (
            current.key === key
                ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
                : { key, dir: 'asc' }
        ));
    };

    const sortedQuestionAnalysis = useMemo(
        () => sortRows(questionAnalysis, questionColumns, qSort),
        [questionAnalysis, qSort.key, qSort.dir]
    );

    const notAttemptedColumns = [
        { key: 'name', label: 'Nama', type: 'text', value: (s) => s.name },
        { key: 'nrp', label: 'NRP', type: 'text', value: (s) => s.nrp },
        { key: 'class_name', label: 'Kelas', type: 'text', value: (s) => s.class_name },
        { key: 'has_logged_in', label: 'Sudah Login', type: 'number', value: (s) => (s.has_logged_in ? 1 : 0) },
    ];

    const toggleNSort = (key) => {
        setNSort((current) => (
            current.key === key
                ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
                : { key, dir: 'asc' }
        ));
    };

    const sortedNotAttempted = useMemo(
        () => sortRows(notAttempted, notAttemptedColumns, nSort),
        [notAttempted, nSort.key, nSort.dir]
    );

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

                    <div className="report-tabs">
                        <button
                            className={`report-tab${tab === 'results' ? ' active' : ''}`}
                            onClick={() => setTab('results')}
                        >Hasil Mahasiswa</button>
                        <button
                            className={`report-tab${tab === 'analysis' ? ' active' : ''}`}
                            onClick={() => setTab('analysis')}
                        >Analisa Butir Soal</button>
                        <button
                            className={`report-tab${tab === 'not_attempted' ? ' active' : ''}`}
                            onClick={() => setTab('not_attempted')}
                        >Belum Mengerjakan <span className="tab-badge">{notAttempted.length}</span></button>
                    </div>

                    {tab === 'results' && (
                    <section className="panel">
                        <h2>Hasil Mahasiswa</h2>
                        <div className="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>No</th>
                                        {studentColumns.map((column) => (
                                            <th
                                                key={column.key}
                                                className="sortable"
                                                onClick={() => toggleSort(column.key)}
                                                role="button"
                                                title="Klik untuk urutkan"
                                            >
                                                <span className="th-sort">
                                                    {column.label}
                                                    {sort.key === column.key
                                                        ? (sort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)
                                                        : <ChevronsUpDown size={14} className="th-sort-idle" />}
                                                </span>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedStudentResults.map((attempt, index) => (
                                        <tr key={attempt.id}>
                                            <td>{index + 1}</td>
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
                                            <td>{attempt.proctor_warnings || 0}/{PROCTOR_WARNING_LIMIT}</td>
                                            <td>{attempt.proctor_violation ? <span className="badge badge-warn">Pelanggaran</span> : <span className="badge">Aman</span>}</td>
                                        </tr>
                                    ))}
                                    {sortedStudentResults.length === 0 && <tr><td colSpan="14">Belum ada attempt sesuai filter.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </section>
                    )}

                    {tab === 'analysis' && (
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
                                        {questionColumns.map((column) => (
                                            <th
                                                key={column.key}
                                                className="sortable"
                                                onClick={() => toggleQSort(column.key)}
                                                role="button"
                                                title="Klik untuk urutkan"
                                            >
                                                <span className="th-sort">
                                                    {column.label}
                                                    {qSort.key === column.key
                                                        ? (qSort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)
                                                        : <ChevronsUpDown size={14} className="th-sort-idle" />}
                                                </span>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedQuestionAnalysis.map((question) => (
                                        <tr key={question.question_id}>
                                            <td>{question.number}</td>
                                            <td>{question.week || '-'}</td>
                                            <td><span className="badge">{questionTypeLabel(question.question_type)}</span></td>
                                            <td className="wrap-cell">{question.question_text}</td>
                                            <td>{question.answered_total}</td>
                                            <td>{question.correct_total}</td>
                                            <td>{question.wrong_total}</td>
                                            <td>{question.unanswered_total}</td>
                                            <td>{pct(question.correct_rate)}</td>
                                        </tr>
                                    ))}
                                    {sortedQuestionAnalysis.length === 0 && <tr><td colSpan="9">Belum ada analisa butir soal untuk filter ini.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </section>
                    )}

                    {tab === 'not_attempted' && (
                    <section className="panel">
                        <div className="section-head">
                            <div>
                                <h2>Belum Mengerjakan</h2>
                                <p className="muted">Mahasiswa yang belum memiliki attempt sesuai filter aktif{filters.exam_id ? ' (untuk ujian terpilih)' : filters.course_id ? ' (untuk mata kuliah terpilih)' : ''}. Total {notAttempted.length} mahasiswa.</p>
                            </div>
                        </div>
                        <div className="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>No</th>
                                        {notAttemptedColumns.map((column) => (
                                            <th
                                                key={column.key}
                                                className="sortable"
                                                onClick={() => toggleNSort(column.key)}
                                                role="button"
                                                title="Klik untuk urutkan"
                                            >
                                                <span className="th-sort">
                                                    {column.label}
                                                    {nSort.key === column.key
                                                        ? (nSort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)
                                                        : <ChevronsUpDown size={14} className="th-sort-idle" />}
                                                </span>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedNotAttempted.map((student, index) => (
                                        <tr key={student.id}>
                                            <td>{index + 1}</td>
                                            <td>{student.name || '-'}</td>
                                            <td>{student.nrp || '-'}</td>
                                            <td>{student.class_name || '-'}</td>
                                            <td>
                                                {student.has_logged_in
                                                    ? <span className="badge">Sudah login</span>
                                                    : <span className="badge badge-warn">Belum login</span>}
                                            </td>
                                        </tr>
                                    ))}
                                    {sortedNotAttempted.length === 0 && <tr><td colSpan="5">Semua mahasiswa sudah mengerjakan sesuai filter ini.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </section>
                    )}
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
    class_name: '',
    week: '',
    question_type: 'multiple_choice',
    level: '',
    question_text: '',
    image_url: '',
    option_a: '',
    option_b: '',
    option_c: '',
    option_d: '',
    correct_option: 'a',
    correct_options: { a: false, b: false, c: false, d: false },
    explanation: '',
};

const questionKeys = ['a', 'b', 'c', 'd'];
const questionTypeOptions = [
    { type: 'multiple_choice', label: 'ABCD', title: 'Soal ABCD', helper: 'Pilihan A-D dengan satu kunci jawaban.' },
    { type: 'true_false', label: 'T/F', title: 'Soal True/False', helper: 'Pernyataan A-D dengan kunci benar/salah.' },
    { type: 'hots', label: 'HOTS', title: 'Soal HOTS', helper: 'Uraian bergambar untuk analisis tingkat tinggi.' },
    { type: 'file_upload', label: 'Tugas', title: 'Upload Tugas (PDF)', helper: 'Mahasiswa mengumpulkan satu berkas PDF, dinilai manual.' },
];

function normalizeQuestionType(type) {
    return ['true_false', 'hots', 'file_upload'].includes(type) ? type : 'multiple_choice';
}

function questionTypeLabel(type) {
    return questionTypeOptions.find((item) => item.type === normalizeQuestionType(type))?.label || 'ABCD';
}

function questionTypeMeta(type) {
    return questionTypeOptions.find((item) => item.type === normalizeQuestionType(type)) || questionTypeOptions[0];
}

function answerIsFilled(answer) {
    if (!answer) return false;
    if (answer.question?.question_type === 'file_upload') {
        return Boolean(answer.file_path);
    }

    if (answer.question?.question_type === 'hots') {
        return Boolean((answer.essay_answer || '').trim());
    }

    if (answer.question?.question_type === 'true_false') {
        const selected = answer.selected_options || {};

        return questionKeys.every((key) => typeof selected[key] === 'boolean');
    }

    return Boolean(answer.selected_option);
}

function answerDisplay(answer) {
    if (answer.question?.question_type === 'file_upload') {
        return answer.file_original_name || '-';
    }

    if (answer.question?.question_type === 'hots') {
        const value = (answer.essay_answer || '').trim();

        return value ? `${value.slice(0, 80)}${value.length > 80 ? '...' : ''}` : '-';
    }

    if (answer.question?.question_type === 'true_false') {
        const selected = answer.selected_options || {};

        return questionKeys
            .map((key) => `${key.toUpperCase()}: ${typeof selected[key] === 'boolean' ? (selected[key] ? 'Benar' : 'Salah') : '-'}`)
            .join(', ');
    }

    return answer.selected_option || '-';
}

function questionClassLabel(className) {
    return className || 'Umum';
}

function AdminGrading() {
    const [attempts, setAttempts] = useState([]);
    const [gradingAttemptId, setGradingAttemptId] = useState(null);
    const [gradeForm, setGradeForm] = useState({});
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [onlyPending, setOnlyPending] = useState(false);
    const [examFilter, setExamFilter] = useState('');

    const loadAttempts = () => api.get('/api/admin/attempts')
        .then((data) => setAttempts(data.attempts.data))
        .catch((err) => setError(err.message));

    useEffect(() => {
        loadAttempts();
    }, []);

    const toggleGrading = (attempt) => {
        if (gradingAttemptId === attempt.id) {
            setGradingAttemptId(null);
            return;
        }
        const form = {};
        (attempt.answers || []).forEach((answer) => {
            form[answer.id] = {
                manual_score: answer.manual_score ?? '',
                manual_feedback: answer.manual_feedback ?? '',
            };
        });
        setGradeForm(form);
        setGradingAttemptId(attempt.id);
    };

    const saveGrade = async (answer) => {
        const form = gradeForm[answer.id] || {};
        setBusy(`grade-${answer.id}`);
        setMessage('');
        try {
            const data = await api.post(`/api/admin/answers/${answer.id}/grade`, {
                manual_score: form.manual_score === '' ? null : Number(form.manual_score),
                manual_feedback: form.manual_feedback || null,
            });
            setMessage(data.message);
            await loadAttempts();
        } catch (err) {
            setMessage(err.message);
        } finally {
            setBusy('');
        }
    };

    // Hanya attempt yang punya jawaban perlu koreksi (HOTS / tugas PDF).
    const withSubmissions = attempts.filter((attempt) => (attempt.answers || []).length > 0);
    const examOptions = [...new Map(withSubmissions.map((attempt) => [attempt.exam?.id, attempt.exam])).values()]
        .filter(Boolean)
        .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    const gradable = withSubmissions
        .filter((attempt) => ! examFilter || String(attempt.exam?.id) === examFilter)
        .filter((attempt) => ! onlyPending || (attempt.answers || []).some((answer) => answer.manual_score == null));
    const pendingCount = attempts.reduce((total, attempt) => total
        + (attempt.answers || []).filter((answer) => answer.manual_score == null).length, 0);

    return (
        <div className="admin-page">
            <section className="admin-titlebar">
                <div>
                    <h1>Nilai &amp; Koreksi</h1>
                    <p className="muted">Koreksi esai HOTS &amp; tugas PDF. Nilai akhir otomatis digabung dengan skor PG/TF (tiap soal 1 poin, jawaban manual = nilai/100 poin).</p>
                </div>
                <button className="btn secondary" onClick={loadAttempts}><RotateCcw size={17} /> Refresh</button>
            </section>

            {message && <div className={`alert ${message.toLowerCase().includes('gagal') || message.toLowerCase().includes('error') ? 'error' : ''}`}>{message}</div>}
            {error && <div className="alert error">{error}</div>}

            <section className="admin-overview" aria-label="Ringkasan koreksi">
                <div className="overview-item"><span>Attempt perlu koreksi</span><strong>{gradable.length}</strong></div>
                <div className="overview-item"><span>Jawaban belum dinilai</span><strong>{pendingCount}</strong></div>
            </section>

            <section className="panel">
                <div className="section-head">
                    <div>
                        <h2>Daftar Koreksi</h2>
                        <p className="muted">Klik <strong>Nilai</strong> untuk membaca jawaban dan memberi skor. Hingga 50 attempt terakhir.</p>
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div className="field" style={{ margin: 0, minWidth: 200 }}>
                            <label>Ujian</label>
                            <select value={examFilter} onChange={(event) => { setExamFilter(event.target.value); setGradingAttemptId(null); }}>
                                <option value="">Semua ujian</option>
                                {examOptions.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}
                            </select>
                        </div>
                        <label className="check-row compact" style={{ margin: 0 }}>
                            <input type="checkbox" checked={onlyPending} onChange={(event) => setOnlyPending(event.target.checked)} />
                            Hanya yang belum dinilai
                        </label>
                    </div>
                </div>
                <div className="table-wrap">
                    <table>
                        <thead><tr><th>#</th><th>Nama</th><th>NRP</th><th>Ujian</th><th>Paket</th><th>Status</th><th>Skor</th><th>Grade</th><th>Koreksi</th></tr></thead>
                        <tbody>
                            {gradable.map((attempt, rowIndex) => {
                                const submissions = attempt.answers || [];
                                const expanded = gradingAttemptId === attempt.id;
                                const pending = submissions.filter((answer) => answer.manual_score == null).length;
                                return (
                                    <React.Fragment key={attempt.id}>
                                        <tr>
                                            <td>{rowIndex + 1}</td>
                                            <td>{attempt.user.name}</td>
                                            <td>{attempt.user.nrp}</td>
                                            <td>{attempt.exam.title}</td>
                                            <td>{attempt.package?.code || '-'}</td>
                                            <td><span className={`status-pill mini ${attempt.status === 'submitted' ? 'open' : attempt.status === 'in_progress' ? 'scheduled' : 'closed'}`}>{attempt.status}</span></td>
                                            <td>{attempt.score}/{attempt.total_questions}</td>
                                            <td>{attempt.letter_grade || '-'}</td>
                                            <td>
                                                <button className="btn secondary mini" onClick={() => toggleGrading(attempt)}>
                                                    {expanded ? 'Tutup' : `Nilai (${submissions.length})`}
                                                </button>
                                                {pending > 0 && <span className="status-pill mini scheduled" style={{ marginLeft: 6 }}>{pending} baru</span>}
                                            </td>
                                        </tr>
                                        {expanded && submissions.map((answer) => (
                                            <tr key={answer.id} className="grade-row">
                                                <td colSpan="9">
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', padding: '6px 2px' }}>
                                                        <div style={{ flex: '1 1 320px' }}>
                                                            <span className="badge">{questionTypeLabel(answer.question?.question_type)}</span> <strong>{answer.question?.question_text || '-'}</strong>
                                                            {answer.question?.question_type === 'hots' ? (
                                                                <div className="muted" style={{ marginTop: 6, whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto', background: 'var(--surface-2, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 8, padding: 10 }}>
                                                                    {(answer.essay_answer || '').trim() || 'Belum dijawab mahasiswa.'}
                                                                </div>
                                                            ) : (
                                                                <div className="muted" style={{ marginTop: 4 }}>
                                                                    {answer.file_path
                                                                        ? <a href={`/api/admin/answers/${answer.id}/file`} target="_blank" rel="noreferrer"><FileUp size={14} /> {answer.file_original_name || 'tugas.pdf'}{answer.file_size ? ` (${Math.round(answer.file_size / 1024)} KB)` : ''}</a>
                                                                        : 'Belum mengumpulkan berkas.'}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="field" style={{ width: 110, margin: 0 }}>
                                                            <label>Nilai (0-100)</label>
                                                            <input type="number" min="0" max="100" step="0.01" value={gradeForm[answer.id]?.manual_score ?? ''} onChange={(event) => setGradeForm({ ...gradeForm, [answer.id]: { ...gradeForm[answer.id], manual_score: event.target.value } })} />
                                                        </div>
                                                        <div className="field" style={{ flex: '1 1 200px', margin: 0 }}>
                                                            <label>Catatan</label>
                                                            <input value={gradeForm[answer.id]?.manual_feedback ?? ''} onChange={(event) => setGradeForm({ ...gradeForm, [answer.id]: { ...gradeForm[answer.id], manual_feedback: event.target.value } })} />
                                                        </div>
                                                        <button className="btn primary mini" disabled={busy === `grade-${answer.id}`} onClick={() => saveGrade(answer)}>Simpan</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                );
                            })}
                            {gradable.length === 0 && <tr><td colSpan="9">{onlyPending ? 'Tidak ada jawaban yang belum dinilai.' : 'Belum ada jawaban HOTS atau tugas untuk dikoreksi.'}</td></tr>}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}

function AdminImport() {
    const [file, setFile] = useState(null);
    const [importClass, setImportClass] = useState('');
    const [message, setMessage] = useState('');
    const [exams, setExams] = useState([]);
    const [courses, setCourses] = useState([]);
    const [classes, setClasses] = useState([]);
    const [selectedExamId, setSelectedExamId] = useState('');
    const [examForm, setExamForm] = useState({ course_id: '', title: '', class_name: '', duration_minutes: 60, multiple_choice_count: 0, true_false_count: 0, hots_count: 0, is_active: true, opens_at: '', closes_at: '' });
    const [settings, setSettings] = useState({ course_id: '', title: '', class_name: '', duration_minutes: 60, is_active: true, opens_at: '', closes_at: '' });
    const [resetClass, setResetClass] = useState('');
    const [questions, setQuestions] = useState([]);
    const [questionForm, setQuestionForm] = useState(emptyQuestionForm);
    const [editingQuestionId, setEditingQuestionId] = useState(null);
    const [activeQuestionType, setActiveQuestionType] = useState('multiple_choice');
    const [questionClassFilter, setQuestionClassFilter] = useState('__all');
    const [busy, setBusy] = useState('');

    const loadExams = () => api.get('/api/admin/exams').then((data) => {
        setExams(data.exams || []);
        setCourses(data.courses || []);
        setClasses(data.classes || []);
        setSelectedExamId((current) => current || String(data.exams?.[0]?.id || ''));
    });

    useEffect(() => {
        loadExams();
    }, []);

    const selectedExam = exams.find((exam) => String(exam.id) === String(selectedExamId));
    const selectedStatus = examStatus(selectedExam);
    const totalQuestions = exams.reduce((total, exam) => total + Number(exam.questions_count || 0), 0);
    const openExams = exams.filter((exam) => exam.is_open_now).length;
    const totalAttempts = exams.reduce((total, exam) => total + Number(exam.attempts_count || 0), 0);
    const editingQuestion = questions.find((question) => question.id === editingQuestionId);
    const activeQuestionClass = questionClassFilter === '__all' ? '' : questionClassFilter;
    const classFilteredQuestions = questions.filter((question) => questionClassFilter === '__all' || (question.class_name || '') === questionClassFilter);
    const questionCounts = questionTypeOptions.reduce((counts, item) => ({
        ...counts,
        [item.type]: classFilteredQuestions.filter((question) => normalizeQuestionType(question.question_type) === item.type).length,
    }), {});
    const filteredQuestions = classFilteredQuestions.filter((question) => normalizeQuestionType(question.question_type) === activeQuestionType);
    const activeQuestionMeta = questionTypeMeta(activeQuestionType);

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
            course_id: selectedExam.course_id || '',
            title: selectedExam.title || '',
            class_name: selectedExam.class_name || '',
            duration_minutes: selectedExam.duration_minutes || 60,
            is_active: Boolean(selectedExam.is_active),
            opens_at: toDatetimeLocal(selectedExam.opens_at),
            closes_at: toDatetimeLocal(selectedExam.closes_at),
        });
    }, [selectedExamId, selectedExam?.duration_minutes, selectedExam?.is_active, selectedExam?.opens_at, selectedExam?.closes_at]);

    useEffect(() => {
        setActiveQuestionType('multiple_choice');
        setQuestionForm({ ...emptyQuestionForm, class_name: activeQuestionClass });
        setEditingQuestionId(null);
        loadQuestions(selectedExamId);
    }, [selectedExamId]);

    useEffect(() => {
        if (editingQuestionId) return;
        setQuestionForm((current) => ({ ...current, class_name: activeQuestionClass }));
    }, [questionClassFilter, editingQuestionId]);

    const upload = async (event) => {
        event.preventDefault();
        if (!file) return;
        const body = new FormData();
        body.append('file', file);
        if (importClass) body.append('class_name', importClass);
        const data = await api.post('/api/admin/questions/import', body);
        setMessage(`${data.message} Target: ${questionClassLabel(importClass)}. Total soal: ${data.question_count}.`);
        await Promise.all([loadExams(), loadQuestions()]);
    };

    const createExam = async (event) => {
        event.preventDefault();
        setBusy('exam-create');
        setMessage('');
        try {
            const data = await api.post('/api/admin/exams', {
                ...examForm,
                course_id: Number(examForm.course_id),
                class_name: examForm.class_name || null,
                duration_minutes: Number(examForm.duration_minutes || 60),
                multiple_choice_count: Number(examForm.multiple_choice_count || 0),
                true_false_count: Number(examForm.true_false_count || 0),
                hots_count: Number(examForm.hots_count || 0),
                opens_at: examForm.opens_at || null,
                closes_at: examForm.closes_at || null,
            });
            setMessage(data.message);
            setExamForm({ course_id: examForm.course_id, title: '', class_name: examForm.class_name, duration_minutes: 60, multiple_choice_count: 0, true_false_count: 0, hots_count: 0, is_active: true, opens_at: '', closes_at: '' });
            await loadExams();
            setSelectedExamId(String(data.exam.id));
        } catch (err) {
            setMessage(err.message);
        } finally {
            setBusy('');
        }
    };

    const saveSettings = async (nextActive = settings.is_active) => {
        if (!selectedExam) return;
        setBusy('settings');
        setMessage('');
        try {
            const data = await api.post(`/api/admin/exams/${selectedExam.id}/settings`, {
                course_id: Number(settings.course_id),
                title: settings.title,
                class_name: settings.class_name || null,
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

    const deleteExam = async () => {
        if (!selectedExam) return;
        if (!confirm(`Hapus ujian ${selectedExam.title}? Soal dan paket ujian ini juga akan dihapus.`)) return;

        setBusy('exam-delete');
        setMessage('');
        try {
            const data = await api.delete(`/api/admin/exams/${selectedExam.id}`);
            setMessage(data.message);
            setSelectedExamId('');
            setQuestions([]);
            await loadExams();
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
            await loadExams();
        } catch (err) {
            setMessage(err.message);
        } finally {
            setBusy('');
        }
    };

    const editQuestion = (question) => {
        const nextType = normalizeQuestionType(question.question_type);
        setActiveQuestionType(nextType);
        setEditingQuestionId(question.id);
        setQuestionForm({
            class_name: question.class_name || '',
            week: question.week || '',
            question_type: nextType,
            level: question.level || '',
            question_text: question.question_text || '',
            image_url: question.image_url || '',
            option_a: question.option_a || '',
            option_b: question.option_b || '',
            option_c: question.option_c || '',
            option_d: question.option_d || '',
            correct_option: question.correct_option || 'a',
            correct_options: question.correct_options || { a: false, b: false, c: false, d: false },
            explanation: question.explanation || '',
        });
    };

    const clearQuestionForm = () => {
        setEditingQuestionId(null);
        setQuestionForm({ ...emptyQuestionForm, class_name: activeQuestionClass, question_type: activeQuestionType });
    };

    const switchQuestionType = (type) => {
        const nextType = normalizeQuestionType(type);
        setActiveQuestionType(nextType);
        setEditingQuestionId(null);
        setQuestionForm({ ...emptyQuestionForm, class_name: activeQuestionClass, question_type: nextType });
    };

    const saveQuestion = async (event) => {
        event.preventDefault();
        if (!selectedExam) return;

        setBusy('question');
        setMessage('');
        try {
            const payload = {
                ...questionForm,
                class_name: questionForm.class_name || null,
                week: questionForm.week ? Number(questionForm.week) : null,
                correct_option: questionForm.question_type === 'true_false' ? 'a' : questionForm.correct_option,
                correct_options: questionForm.question_type === 'true_false' ? questionForm.correct_options : null,
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
                                        <small>{exam.course?.name || '-'} | Kelas {questionClassLabel(exam.class_name)} | {exam.questions_count} soal</small>
                                    </span>
                                    <i className={`status-dot ${status.className}`} />
                                </button>
                            );
                        })}
                    </div>

                    <form className="import-box" onSubmit={createExam}>
                        <h3>Buat Ujian</h3>
                        <div className="field">
                            <label>Mata Kuliah</label>
                            <select value={examForm.course_id} onChange={(event) => setExamForm({ ...examForm, course_id: event.target.value })} required>
                                <option value="">Pilih mata kuliah</option>
                                {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
                            </select>
                        </div>
                        <div className="field">
                            <label>Target Kelas</label>
                            <select value={examForm.class_name} onChange={(event) => setExamForm({ ...examForm, class_name: event.target.value })}>
                                <option value="">Umum / semua kelas</option>
                                {classes.map((className) => <option key={className} value={className}>{className}</option>)}
                            </select>
                        </div>
                        <div className="field">
                            <label>Judul Ujian</label>
                            <input value={examForm.title} onChange={(event) => setExamForm({ ...examForm, title: event.target.value })} placeholder="Quiz Desain Web Kelas A" required />
                        </div>
                        <div className="field">
                            <label>Durasi</label>
                            <input type="number" min="1" max="300" value={examForm.duration_minutes} onChange={(event) => setExamForm({ ...examForm, duration_minutes: event.target.value })} required />
                        </div>
                        <div className="field">
                            <label>Ambil ABCD dari Bank</label>
                            <input type="number" min="0" max="500" value={examForm.multiple_choice_count} onChange={(event) => setExamForm({ ...examForm, multiple_choice_count: event.target.value })} />
                        </div>
                        <div className="field">
                            <label>Ambil T/F dari Bank</label>
                            <input type="number" min="0" max="500" value={examForm.true_false_count} onChange={(event) => setExamForm({ ...examForm, true_false_count: event.target.value })} />
                        </div>
                        <div className="field">
                            <label>Ambil HOTS dari Bank</label>
                            <input type="number" min="0" max="500" value={examForm.hots_count} onChange={(event) => setExamForm({ ...examForm, hots_count: event.target.value })} />
                        </div>
                        <p className="muted compact-note">Isi 0 jika ujian dibuat kosong lalu soal dimasukkan lewat Import Soal.</p>
                        <button className="btn primary" disabled={busy === 'exam-create'}><Plus size={17} /> Buat Ujian</button>
                    </form>

                    <form className="import-box" onSubmit={upload}>
                        <h3>Import Soal</h3>
                        <div className="field">
                            <label>Target Kelas</label>
                            <select value={importClass} onChange={(event) => setImportClass(event.target.value)}>
                                <option value="">Umum / semua kelas</option>
                                {classes.map((className) => <option key={className} value={className}>{className}</option>)}
                            </select>
                        </div>
                        <input className="file-input" type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files[0])} />
                        <button className="btn primary"><FileUp size={17} /> Import JSON</button>
                    </form>
                </aside>

                <section className="panel admin-control">
                    <div className="section-head">
                        <div>
                            <h2>{selectedExam?.title || 'Pengaturan Ujian'}</h2>
                            <p className="muted">{selectedExam ? `${selectedExam.course?.name || '-'} | Kelas ${questionClassLabel(selectedExam.class_name)}` : 'Pilih ujian untuk mengatur akses mahasiswa.'}</p>
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
                                    <label>Mata Kuliah</label>
                                    <select value={settings.course_id} onChange={(event) => setSettings({ ...settings, course_id: event.target.value })}>
                                        {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
                                    </select>
                                </div>
                                <div className="field">
                                    <label>Judul Ujian</label>
                                    <input value={settings.title} onChange={(event) => setSettings({ ...settings, title: event.target.value })} />
                                </div>
                                <div className="field">
                                    <label>Target Kelas</label>
                                    <select value={settings.class_name} onChange={(event) => setSettings({ ...settings, class_name: event.target.value })}>
                                        <option value="">Umum / semua kelas</option>
                                        {classes.map((className) => <option key={className} value={className}>{className}</option>)}
                                    </select>
                                </div>
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
                                <button className="btn danger" disabled={busy === 'exam-delete'} onClick={deleteExam}><Trash2 size={17} /> Hapus Ujian</button>
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
                        <div className="field">
                            <label>Kelas Soal</label>
                            <select value={questionClassFilter} onChange={(event) => {
                                setQuestionClassFilter(event.target.value);
                                setEditingQuestionId(null);
                            }}>
                                <option value="__all">Semua kelas</option>
                                <option value="">Umum</option>
                                {classes.map((className) => <option key={className} value={className}>{className}</option>)}
                            </select>
                        </div>
                        <div className="question-type-tabs" aria-label="Filter jenis soal">
                            {questionTypeOptions.map((item) => (
                                <button
                                    key={item.type}
                                    className={`question-type-tab ${activeQuestionType === item.type ? 'active' : ''}`}
                                    onClick={() => switchQuestionType(item.type)}
                                >
                                    <span>{item.label}</span>
                                    <strong>{questionCounts[item.type] || 0}</strong>
                                </button>
                            ))}
                        </div>
                        <div className="question-list">
                            {filteredQuestions.map((question, index) => (
                                <button
                                    key={question.id}
                                    className={`question-list-item ${editingQuestionId === question.id ? 'active' : ''}`}
                                    onClick={() => editQuestion(question)}
                                >
                                    <span className="question-number">{index + 1}</span>
                                    <span>
                                        <strong>{question.question_text}</strong>
                                        <small>
                                            {questionTypeLabel(question.question_type)} | Minggu {question.week || '-'} | {question.question_type === 'true_false'
                                                ? `Benar: ${questionKeys.filter((key) => question.correct_options?.[key]).map((key) => key.toUpperCase()).join(', ') || '-'}`
                                                : question.question_type === 'hots'
                                                    ? `Level ${question.level || 'berat'}`
                                                : question.question_type === 'file_upload'
                                                    ? 'Berkas PDF'
                                                : `Kunci ${String(question.correct_option || '-').toUpperCase()}`}
                                            {' '}| Kelas {questionClassLabel(question.class_name)}
                                        </small>
                                    </span>
                                </button>
                            ))}
                            {filteredQuestions.length === 0 && <div className="empty-state">Belum ada soal {activeQuestionMeta.label} pada ujian ini.</div>}
                        </div>
                    </div>

                    <QuestionEditorCard
                        type={activeQuestionType}
                        title={activeQuestionMeta.title}
                        count={questionCounts[activeQuestionType] || 0}
                        editingQuestion={editingQuestion}
                        selectedExam={selectedExam}
                        classes={classes}
                        questionForm={questionForm}
                        setQuestionForm={setQuestionForm}
                        busy={busy}
                        saveQuestion={saveQuestion}
                        clearQuestionForm={clearQuestionForm}
                        deleteQuestion={deleteQuestion}
                    />
                </div>
            </section>
        </div>
    );
}

function QuestionEditorCard({
    type,
    title,
    count,
    editingQuestion,
    selectedExam,
    classes,
    questionForm,
    setQuestionForm,
    busy,
    saveQuestion,
    clearQuestionForm,
    deleteQuestion,
}) {
    const isTrueFalse = type === 'true_false';
    const isHots = type === 'hots';
    const isFileUpload = type === 'file_upload';
    const meta = questionTypeMeta(type);
    const canSubmit = selectedExam && busy !== 'question';
    const editingThisType = editingQuestion && normalizeQuestionType(editingQuestion.question_type) === type;

    return (
        <form className="question-editor compact-editor active" onSubmit={saveQuestion}>
            <div className="editor-head">
                <div>
                    <h3>{editingThisType ? `Edit ${title}` : title}</h3>
                    <p className="muted">
                        {editingThisType
                            ? `ID soal ${editingQuestion.id}`
                            : `${count} soal tersimpan. ${meta.helper}`}
                    </p>
                </div>
                <span className="status-pill mini open">{meta.label}</span>
            </div>

            <div className="question-form-grid">
                <div className="field">
                    <label>Jenis Soal</label>
                    <input value={meta.label} readOnly />
                </div>
                <div className="field">
                    <label>Target Kelas</label>
                    <select value={questionForm.class_name} onChange={(event) => setQuestionForm({ ...questionForm, class_name: event.target.value, question_type: type })}>
                        <option value="">Umum / semua kelas</option>
                        {classes.map((className) => <option key={className} value={className}>{className}</option>)}
                    </select>
                </div>
                <div className="field">
                    <label>Minggu</label>
                    <input type="number" min="1" max="16" value={questionForm.week} onChange={(event) => setQuestionForm({ ...questionForm, week: event.target.value, question_type: type })} />
                </div>
                {isHots && (
                    <div className="field">
                        <label>Level</label>
                        <input value={questionForm.level} onChange={(event) => setQuestionForm({ ...questionForm, level: event.target.value, question_type: type })} placeholder="berat" />
                    </div>
                )}
                {!isTrueFalse && !isHots && !isFileUpload && (
                    <div className="field">
                        <label>Kunci</label>
                        <select value={questionForm.correct_option} onChange={(event) => setQuestionForm({ ...questionForm, correct_option: event.target.value, question_type: type })}>
                            <option value="a">A</option>
                            <option value="b">B</option>
                            <option value="c">C</option>
                            <option value="d">D</option>
                        </select>
                    </div>
                )}
            </div>

            {isHots && (
                <div className="field">
                    <label>URL Gambar</label>
                    <input value={questionForm.image_url} onChange={(event) => setQuestionForm({ ...questionForm, image_url: event.target.value, question_type: type })} placeholder="/hots/web-server-architecture.svg" />
                </div>
            )}

            {isFileUpload && (
                <p className="muted compact-note">Mahasiswa hanya mengunggah satu berkas <strong>PDF</strong> (maks 10 MB). Opsi A-D dan kunci tidak diperlukan. Buat ujian ini berisi 1 soal tugas saja, atur masa buka/tutup sebagai deadline, lalu nilai dari panel Attempt.</p>
            )}

            <div className="field">
                <label>{isTrueFalse ? 'Instruksi / Pertanyaan Utama' : isHots ? 'Instruksi Analisis' : isFileUpload ? 'Instruksi Tugas' : 'Pertanyaan'}</label>
                <textarea rows="4" value={questionForm.question_text} onChange={(event) => setQuestionForm({ ...questionForm, question_text: event.target.value, question_type: type })} placeholder={isFileUpload ? 'Contoh: Kumpulkan laporan praktikum minggu 5 dalam format PDF.' : ''} required />
            </div>

            {!isHots && !isFileUpload && questionKeys.map((option) => (
                <div className="field" key={option}>
                    <label>{isTrueFalse ? `Pernyataan ${option.toUpperCase()}` : `Opsi ${option.toUpperCase()}`}</label>
                    <textarea rows="2" value={questionForm[`option_${option}`]} onChange={(event) => setQuestionForm({ ...questionForm, [`option_${option}`]: event.target.value, question_type: type })} required />
                    {isTrueFalse && (
                        <label className="check-row compact">
                            <input
                                type="checkbox"
                                checked={Boolean(questionForm.correct_options?.[option])}
                                onChange={(event) => setQuestionForm({
                                    ...questionForm,
                                    question_type: type,
                                    correct_options: { ...questionForm.correct_options, [option]: event.target.checked },
                                })}
                            />
                            Pernyataan ini benar
                        </label>
                    )}
                </div>
            ))}

            <div className="field">
                <label>{isHots ? 'Pedoman Jawaban' : isFileUpload ? 'Catatan / Rubrik (opsional)' : 'Pembahasan'}</label>
                <textarea rows="3" value={questionForm.explanation} onChange={(event) => setQuestionForm({ ...questionForm, explanation: event.target.value, question_type: type })} />
            </div>

            <div className="action-row">
                <button className="btn primary" disabled={!canSubmit}><Plus size={17} /> {editingThisType ? 'Simpan Perubahan' : `Tambah ${meta.label}`}</button>
                <button type="button" className="btn secondary" onClick={clearQuestionForm}><X size={17} /> Kosongkan</button>
                {editingThisType && (
                    <button type="button" className="btn danger" disabled={busy === 'question'} onClick={() => deleteQuestion(editingQuestion)}><Trash2 size={17} /> Hapus</button>
                )}
            </div>
        </form>
    );
}

createRoot(document.getElementById('root')).render(<App />);
