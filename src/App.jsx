import { useEffect, useState, useCallback } from 'react';
import emailjs from '@emailjs/browser';
import {
  getScholarships, addScholarship, deleteScholarship,
  getApplications, addApplication, updateApplicationStatus, getSettings, saveSettings
} from './dataStore';

function useHashView() {
  const [view, setView] = useState(window.location.hash === '#admin' ? 'admin' : 'portal');
  useEffect(() => {
    const onHash = () => setView(window.location.hash === '#admin' ? 'admin' : 'portal');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return view;
}

export default function App() {
  const view = useHashView();
  return view === 'admin' ? <AdminPanel /> : <StudentPortal />;
}

/* ============================================================
   STUDENT PORTAL
   ============================================================ */
function StudentPortal() {
  const [scholarships, setScholarships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({ feeAmount: 0, emailjsPublicKey: '', emailjsServiceId: '', emailjsTemplateId: '' });
  const [openScholarship, setOpenScholarship] = useState(null);

  useEffect(() => {
    (async () => {
      const [list, s] = await Promise.all([getScholarships(), getSettings()]);
      setScholarships(list);
      setSettings(s);
      if (s.emailjsPublicKey) emailjs.init({ publicKey: s.emailjsPublicKey });
      setLoading(false);
    })();
  }, []);

  // Handle returning from ZapUPI's payment page (success/failed/timeout all land here).
  useEffect(() => {
    if (!window.location.hash.startsWith('#payment-return')) return;
    const docId = sessionStorage.getItem('pendingApplicationId');
    const orderId = sessionStorage.getItem('pendingOrderId');
    const raw = sessionStorage.getItem('pendingApplication');
    if (!docId || !orderId) return;
    (async () => {
      const status = await checkPaymentStatus(orderId);
      const parsedApp = raw ? JSON.parse(raw) : null;
      if (status === 'Success') {
        await updateApplicationStatus(docId, 'paid');
        if (parsedApp) sendConfirmationEmail(parsedApp, settings);
        alert('Payment confirmed. Scholarship successfully applied. Please wait for the scholarship process.\n\nYour reference ID: ' + (parsedApp ? parsedApp.id : docId));
      } else {
        await updateApplicationStatus(docId, 'failed');
        alert('Payment was not completed (' + status + '). Your details were saved, but you may want to apply again once you are ready to pay.');
      }
      sessionStorage.removeItem('pendingApplication');
      sessionStorage.removeItem('pendingApplicationId');
      sessionStorage.removeItem('pendingOrderId');
      window.location.hash = '';
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  return (
    <>
      <header className="top">
        <div className="brand">
          <div className="mark">VN</div>
          <div className="brand-text">
            <div className="name">Vidya Nidhi</div>
            <div className="tag">Scholarship Portal</div>
          </div>
        </div>
      </header>

      <div className="hero">
        <div className="eyebrow">Applications open</div>
        <h1>Find a scholarship worth applying for.</h1>
        <p>Browse scholarships listed by our partner companies, check the award amount, and submit your details in one form.</p>
      </div>

      <main>
        <div className="section-head">
          <h2>Open Scholarships</h2>
          <div className="count">{loading ? 'Loading…' : `${scholarships.length} scholarships`}</div>
        </div>
        <div className="grid">
          {!loading && scholarships.length === 0 && (
            <div className="empty">No scholarships are open right now. Please check back soon.</div>
          )}
          {scholarships.map(s => (
            <div className="card" key={s.id}>
              {s.imageUrl && (
                <img
                  src={s.imageUrl}
                  alt={s.title}
                  style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 7, marginBottom: -2 }}
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              )}
              <div className="co">{s.company || 'Sponsor'}</div>
              <h3>{s.title}</h3>
              <div className="desc">{s.description}</div>
              <div className="meta">
                <div className="amount">₹{Number(s.price || 0).toLocaleString('en-IN')}<br /><small>award amount</small></div>
                <button className="btn btn-primary" onClick={() => setOpenScholarship(s)}>Apply Now</button>
              </div>
              {Number(s.applicationFee) > 0 && (
                <div className="hint">Application fee: ₹{Number(s.applicationFee).toLocaleString('en-IN')}</div>
              )}
            </div>
          ))}
        </div>
      </main>

      <footer>
        Vidya Nidhi Scholarship Portal — applications are reviewed by the listing company/sponsor.
        <br /><a href="#admin">Admin Panel</a>
      </footer>

      {openScholarship && (
        <ApplyModal
          scholarship={openScholarship}
          settings={settings}
          onClose={() => setOpenScholarship(null)}
        />
      )}
    </>
  );
}

async function checkPaymentStatus(orderId, attempt = 0) {
  try {
    const res = await fetch('/api/zapupi-order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId })
    });
    const data = await res.json();
    const status = data?.data?.status || data?.status;
    if (status === 'Pending' && attempt < 5) {
      await new Promise(r => setTimeout(r, 2000));
      return checkPaymentStatus(orderId, attempt + 1);
    }
    return status || 'Failed';
  } catch (e) {
    return 'Failed';
  }
}

function sendConfirmationEmail(app, settings) {
  if (!(settings.emailjsServiceId && settings.emailjsTemplateId && settings.emailjsPublicKey)) return;
  emailjs.send(settings.emailjsServiceId, settings.emailjsTemplateId, {
    to_email: app.gmail,
    applicant_name: app.aadharName,
    scholarship_title: app.scholarshipTitle,
    reference_id: app.id,
    message: 'Scholarship successfully applied. Please wait for the scholarship process. Your reference ID is ' + app.id + '.'
  }).catch(() => {});
}

function ApplyModal({ scholarship, settings, onClose }) {
  const [form, setForm] = useState({
    gmail: '', phone: '', state: '', district: '', city: '', institute: '', classYear: scholarship.eligibleClass || '',
    aadharLast4: '', aadharName: '', aadharDob: ''
  });
  const [errors, setErrors] = useState({});
  const [stage, setStage] = useState('form'); // form | paying | done
  const [payMsg, setPayMsg] = useState('');
  const [refId, setRefId] = useState('');

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const validate = () => {
    const e = {};
    if (!/^.+@gmail\.com$/.test(form.gmail)) e.gmail = 'Please enter a valid Gmail address.';
    if (!/^[0-9]{10}$/.test(form.phone)) e.phone = 'Enter a valid 10-digit phone number.';
    if (!/^[0-9]{4}$/.test(form.aadharLast4)) e.aadharLast4 = 'Enter the last 4 digits of your Aadhaar.';
    ['state', 'district', 'city', 'institute', 'classYear', 'aadharName', 'aadharDob'].forEach(k => {
      if (!form[k]) e[k] = 'Required';
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;

    const { aadharLast4, ...rest } = form;
    const application = {
      id: 'APP-' + Date.now().toString(36).toUpperCase(),
      scholarshipId: scholarship.id,
      scholarshipTitle: scholarship.title,
      company: scholarship.company,
      ...rest,
      aadharNumber: 'XXXX XXXX ' + aadharLast4
    };

    const fee = Number(scholarship.applicationFee || 0);

    if (fee > 0) {
      const docId = await addApplication({ ...application, paymentStatus: 'pending' });
      setStage('paying');
      setPayMsg('Creating your payment order…');
      const orderId = 'ORD' + Date.now();
      sessionStorage.setItem('pendingApplication', JSON.stringify(application));
      sessionStorage.setItem('pendingApplicationId', docId);
      sessionStorage.setItem('pendingOrderId', orderId);
      try {
        const res = await fetch('/api/zapupi-create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_id: orderId, amount: fee, customer_mobile: form.phone, remark: application.id })
        });
        const data = await res.json();
        if (data.status === 'success' && data.payment_url) {
          window.location.href = data.payment_url; // same-tab redirect
        } else {
          setPayMsg('Could not start payment: ' + (data.message || 'unknown error') + '. Your details are saved — you can try paying again by re-applying.');
        }
      } catch (err) {
        setPayMsg('Could not reach the payment server. Your details are saved — you can try again shortly.');
      }
    } else {
      const docId = await addApplication({ ...application, paymentStatus: 'not_required' });
      sendConfirmationEmail(application, settings);
      setRefId(application.id);
      setStage('done');
    }
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <button className="close-x" onClick={onClose}>&times;</button>
          <div className="token">{scholarship.company || 'Sponsor'}</div>
          <h3>{scholarship.title}</h3>
        </div>

        {stage === 'form' && (
          <>
            <div className="modal-body">
              <form id="appForm" onSubmit={handleSubmit}>
                <div className="divider-label">Contact details</div>
                <div className="form-row">
                  <label>Gmail ID <span className="req">*</span></label>
                  <input type="email" placeholder="yourname@gmail.com" value={form.gmail} onChange={e => update('gmail', e.target.value)} />
                  {errors.gmail && <div className="err">{errors.gmail}</div>}
                </div>
                <div className="form-row">
                  <label>Phone Number <span className="req">*</span></label>
                  <input type="tel" maxLength={10} value={form.phone} onChange={e => update('phone', e.target.value)} />
                  {errors.phone && <div className="err">{errors.phone}</div>}
                </div>

                <div className="divider-label">Location & institution</div>
                <div className="form-row two">
                  <div>
                    <label>State <span className="req">*</span></label>
                    <input type="text" value={form.state} onChange={e => update('state', e.target.value)} />
                  </div>
                  <div>
                    <label>District <span className="req">*</span></label>
                    <input type="text" value={form.district} onChange={e => update('district', e.target.value)} />
                  </div>
                </div>
                <div className="form-row">
                  <label>City <span className="req">*</span></label>
                  <input type="text" value={form.city} onChange={e => update('city', e.target.value)} />
                </div>
                <div className="form-row">
                  <label>School / College Name <span className="req">*</span></label>
                  <input type="text" value={form.institute} onChange={e => update('institute', e.target.value)} />
                </div>
                <div className="form-row">
                  <label>Class / Year <span className="req">*</span></label>
                  <select value={form.classYear} disabled={!!scholarship.eligibleClass} onChange={e => update('classYear', e.target.value)}>
                    <option value="">Select…</option>
                    <option value="8th">8th</option>
                    <option value="9th">9th</option>
                    <option value="10th">10th</option>
                    <option value="11th">11th</option>
                    <option value="12th">12th</option>
                    <option value="College - 1st Year">College - 1st Year</option>
                  </select>
                  {scholarship.eligibleClass && <div className="hint">This scholarship is only open to {scholarship.eligibleClass} students.</div>}
                  {errors.classYear && <div className="err">{errors.classYear}</div>}
                </div>

                <div className="divider-label">Aadhaar details</div>
                <div className="form-row">
                  <label>Aadhaar Number — last 4 digits <span className="req">*</span></label>
                  <input type="tel" maxLength={4} placeholder="e.g. 8989" value={form.aadharLast4} onChange={e => update('aadharLast4', e.target.value.replace(/\D/g, ''))} />
                  <div className="hint">We only collect the last 4 digits (shown as XXXX XXXX {form.aadharLast4 || '••••'}).</div>
                  {errors.aadharLast4 && <div className="err">{errors.aadharLast4}</div>}
                </div>
                <div className="form-row">
                  <label>Name (as per Aadhaar) <span className="req">*</span></label>
                  <input type="text" value={form.aadharName} onChange={e => update('aadharName', e.target.value)} />
                </div>
                <div className="form-row">
                  <label>Date of Birth (as per Aadhaar) <span className="req">*</span></label>
                  <input type="date" value={form.aadharDob} onChange={e => update('aadharDob', e.target.value)} />
                </div>
              </form>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-accent" type="submit" form="appForm">Submit Application</button>
            </div>
          </>
        )}

        {stage === 'paying' && (
          <div className="pay-box">
            <div className="amt-label">Application fee</div>
            <div className="amt">₹{Number(scholarship.applicationFee).toLocaleString('en-IN')}</div>
            <div className="status-msg">{payMsg}</div>
          </div>
        )}

        {stage === 'done' && (
          <>
            <div className="success">
              <div className="stamp">&#10003;</div>
              <h3>Application received</h3>
              <p>Scholarship successfully applied. Please wait for the scholarship process.</p>
              <p>A confirmation has been sent to your Gmail.</p>
              <div className="refno">Reference ID: {refId}</div>
            </div>
            <div className="modal-foot" style={{ justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   ADMIN PANEL — reached via the "Admin Panel" link in the footer (#admin)
   ============================================================ */
function AdminPanel() {
  const [authed, setAuthed] = useState(sessionStorage.getItem('adminAuthed') === 'true');
  if (!authed) return <AdminLogin onSuccess={() => setAuthed(true)} />;
  return <AdminPanelInner />;
}

function AdminLogin({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setChecking(true);
    setError('');
    try {
      const res = await fetch('/api/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (data.success) {
        sessionStorage.setItem('adminAuthed', 'true');
        onSuccess();
      } else {
        setError(data.message || 'Incorrect password.');
      }
    } catch (err) {
      setError('Could not reach the server. Please try again.');
    }
    setChecking(false);
  };

  return (
    <div className="admin-shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="panel" style={{ maxWidth: 360, width: '100%' }}>
        <h2>Admin Login</h2>
        <form onSubmit={submit}>
          <div className="form-row">
            <label>Password</label>
            <input type="password" autoFocus value={password} onChange={e => setPassword(e.target.value)} />
            {error && <div className="err">{error}</div>}
          </div>
          <div className="btn-row">
            <button className="btn btn-accent" type="submit" disabled={checking}>
              {checking ? 'Checking…' : 'Log In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AdminPanelInner() {
  const [tab, setTab] = useState('dashboard');
  const [scholarships, setScholarships] = useState([]);
  const [applications, setApplications] = useState([]);
  const [settings, setSettings] = useState({ feeAmount: 0, emailjsPublicKey: '', emailjsServiceId: '', emailjsTemplateId: '' });

  const reload = useCallback(async () => {
    const [s, a, st] = await Promise.all([getScholarships(), getApplications(), getSettings()]);
    setScholarships(s); setApplications(a); setSettings(st);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const totalValue = scholarships.reduce((sum, s) => sum + Number(s.price || 0), 0);

  return (
    <div className="admin-shell">
      <aside className="admin-side">
        <div className="brand" style={{ marginBottom: 32 }}>
          <div className="mark">VN</div>
          <div className="brand-text">
            <div className="name">Vidya Nidhi</div>
            <div className="tag">Admin Panel</div>
          </div>
        </div>
        {['dashboard', 'scholarships', 'applications', 'settings'].map(t => (
          <div key={t} className={'navitem' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
            {t === 'scholarships' && <span className="badge">{scholarships.length}</span>}
            {t === 'applications' && <span className="badge">{applications.length}</span>}
          </div>
        ))}
        <div className="navitem" onClick={() => { window.location.hash = ''; }}>← Back to site</div>
        <div className="navitem" onClick={() => { sessionStorage.removeItem('adminAuthed'); window.location.reload(); }}>Log out</div>
      </aside>

      <div className="admin-main">
        {tab === 'dashboard' && (
          <>
            <div className="page-head"><h1>Dashboard</h1><p>Snapshot of scholarships and applications.</p></div>
            <div className="stats">
              <div className="stat"><div className="n">{scholarships.length}</div><div className="l">Open scholarships</div></div>
              <div className="stat"><div className="n">{applications.length}</div><div className="l">Applications received</div></div>
              <div className="stat"><div className="n">₹{totalValue.toLocaleString('en-IN')}</div><div className="l">Total value listed</div></div>
            </div>
          </>
        )}

        {tab === 'scholarships' && (
          <ScholarshipsTab scholarships={scholarships} onChange={reload} />
        )}

        {tab === 'applications' && (
          <ApplicationsTab applications={applications} />
        )}

        {tab === 'settings' && (
          <SettingsTab settings={settings} onChange={reload} />
        )}
      </div>
    </div>
  );
}

function ScholarshipsTab({ scholarships, onChange }) {
  const [form, setForm] = useState({ title: '', company: '', price: '', applicationFee: '', deadline: '', description: '', imageUrl: '', eligibleClass: '' });
  const [saving, setSaving] = useState(false);
  const [imgProcessing, setImgProcessing] = useState(false);

  const handleImageFile = (file) => {
    if (!file) return;
    setImgProcessing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 800;
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', 0.7);
        setForm(f => ({ ...f, imageUrl: compressed }));
        setImgProcessing(false);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title || !form.company || !form.price) return;
    setSaving(true);
    try {
      await addScholarship({ ...form, price: Number(form.price), applicationFee: Number(form.applicationFee) || 0 });
      setForm({ title: '', company: '', price: '', applicationFee: '', deadline: '', description: '', imageUrl: '', eligibleClass: '' });
      onChange();
    } catch (err) {
      alert('Could not save this scholarship. Check that Firestore is set up and its rules allow writes. (' + err.message + ')');
    }
    setSaving(false);
  };

  const remove = async (id) => {
    if (!confirm('Remove this scholarship listing?')) return;
    try {
      await deleteScholarship(id);
      onChange();
    } catch (err) {
      alert('Could not remove this scholarship. (' + err.message + ')');
    }
  };

  return (
    <>
      <div className="page-head"><h1>Scholarships</h1><p>Upload a new scholarship or remove one that has closed.</p></div>
      <div className="panel">
        <h2>Add a new scholarship</h2>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="form-row"><label>Scholarship Title *</label><input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
            <div className="form-row"><label>Company / Sponsor *</label><input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} /></div>
            <div className="form-row"><label>Award Amount (₹) *</label><input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} /></div>
            <div className="form-row"><label>Application Fee (₹)</label><input type="number" placeholder="0 = free to apply" value={form.applicationFee} onChange={e => setForm(f => ({ ...f, applicationFee: e.target.value }))} /></div>
            <div className="form-row">
              <label>Eligible Class</label>
              <select value={form.eligibleClass} onChange={e => setForm(f => ({ ...f, eligibleClass: e.target.value }))}>
                <option value="">Any class (open to everyone)</option>
                <option value="8th">8th</option>
                <option value="9th">9th</option>
                <option value="10th">10th</option>
                <option value="11th">11th</option>
                <option value="12th">12th</option>
                <option value="College - 1st Year">College - 1st Year</option>
              </select>
              <div className="hint">If set, applicants will have this class auto-selected and locked when they apply.</div>
            </div>
            <div className="form-row"><label>Deadline</label><input type="date" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} /></div>
            <div className="form-row full"><label>Description</label><textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="form-row full">
              <label>Scholarship Image (optional)</label>
              <input type="file" accept="image/*" onChange={e => handleImageFile(e.target.files[0])} />
              {imgProcessing && <div className="hint">Processing image…</div>}
              {form.imageUrl && !imgProcessing && (
                <div style={{ marginTop: 10 }}>
                  <img src={form.imageUrl} alt="Preview" style={{ width: 160, height: 100, objectFit: 'cover', borderRadius: 7, border: '1px solid var(--line)' }} />
                  <button type="button" className="btn btn-ghost" style={{ marginLeft: 10 }} onClick={() => setForm(f => ({ ...f, imageUrl: '' }))}>Remove</button>
                </div>
              )}
            </div>
          </div>
          <div className="btn-row"><button className="btn btn-accent" type="submit" disabled={saving || imgProcessing}>{saving ? 'Uploading…' : imgProcessing ? 'Processing image…' : 'Upload Scholarship'}</button></div>
        </form>
      </div>
      <div className="panel">
        <h2>Live listings</h2>
        <div className="scroll-x">
          <table>
            <thead><tr><th>Title</th><th>Company</th><th>Amount</th><th>Fee</th><th>Class</th><th>Deadline</th><th></th></tr></thead>
            <tbody>
              {scholarships.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)' }}>No scholarships uploaded yet.</td></tr>}
              {scholarships.map(s => (
                <tr key={s.id}>
                  <td><strong>{s.title}</strong></td>
                  <td><span className="co-tag">{s.company}</span></td>
                  <td className="price">₹{Number(s.price).toLocaleString('en-IN')}</td>
                  <td>₹{Number(s.applicationFee || 0).toLocaleString('en-IN')}</td>
                  <td>{s.eligibleClass || 'Any'}</td>
                  <td>{s.deadline || '—'}</td>
                  <td><button className="btn btn-danger" onClick={() => remove(s.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function maskAadhaar(num) {
  if (!num) return num;
  if (num.includes('X')) return num; // already masked at collection time
  if (num.length < 4) return num;
  return 'XXXX XXXX ' + num.slice(-4);
}

function paymentBadge(status) {
  if (status === 'paid') return <span style={{ color: 'var(--green)', fontWeight: 600 }}>Paid</span>;
  if (status === 'pending') return <span style={{ color: 'var(--saffron)', fontWeight: 600 }}>Pending</span>;
  if (status === 'failed') return <span style={{ color: 'var(--red)', fontWeight: 600 }}>Failed</span>;
  return <span style={{ color: 'var(--muted)' }}>—</span>;
}

function ApplicationsTab({ applications }) {
  return (
    <>
      <div className="page-head"><h1>Applications</h1><p>All applicant details submitted from the student portal.</p></div>
      <div className="panel">
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Ref</th><th>Payment</th><th>Scholarship</th><th>Gmail</th><th>Phone</th><th>State</th>
                <th>District</th><th>City</th><th>School/College</th><th>Class/Year</th><th>Aadhaar No.</th>
                <th>Aadhaar Name</th><th>Aadhaar DOB</th>
              </tr>
            </thead>
            <tbody>
              {applications.length === 0 && <tr><td colSpan={13} style={{ textAlign: 'center', color: 'var(--muted)' }}>No applications yet.</td></tr>}
              {applications.map(a => (
                <tr key={a.id}>
                  <td><span className="refid">{a.id}</span></td>
                  <td>{paymentBadge(a.paymentStatus)}</td>
                  <td>{a.scholarshipTitle}</td>
                  <td>{a.gmail}</td>
                  <td>{a.phone}</td>
                  <td>{a.state}</td>
                  <td>{a.district}</td>
                  <td>{a.city}</td>
                  <td>{a.institute}</td>
                  <td>{a.classYear}</td>
                  <td className="mono">{maskAadhaar(a.aadharNumber)}</td>
                  <td>{a.aadharName}</td>
                  <td>{a.aadharDob}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function SettingsTab({ settings, onChange }) {
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);

  const submit = async (e) => {
    e.preventDefault();
    await saveSettings(form);
    onChange();
  };

  return (
    <>
      <div className="page-head"><h1>Settings</h1><p>Email confirmation setup. (Application fees are now set per-scholarship, in the Scholarships tab.)</p></div>
      <div className="panel">
        <h2>Email Confirmation (EmailJS)</h2>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
          Free account at emailjs.com → connect Gmail → create a template → paste the 3 values below.
        </div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="form-row"><label>EmailJS Public Key</label><input value={form.emailjsPublicKey} onChange={e => setForm(f => ({ ...f, emailjsPublicKey: e.target.value }))} /></div>
            <div className="form-row"><label>EmailJS Service ID</label><input value={form.emailjsServiceId} onChange={e => setForm(f => ({ ...f, emailjsServiceId: e.target.value }))} /></div>
            <div className="form-row full"><label>EmailJS Template ID</label><input value={form.emailjsTemplateId} onChange={e => setForm(f => ({ ...f, emailjsTemplateId: e.target.value }))} /></div>
          </div>
          <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--muted)' }}>
            The ZapUPI key itself is set separately as a server environment variable (ZAPUPI_KEY on Vercel) — it never lives in this form or in the code, so it stays private even though this repo is public.
          </div>
          <div className="btn-row"><button className="btn btn-accent" type="submit">Save Settings</button></div>
        </form>
      </div>
    </>
  );
}
