import { useEffect, useState, useCallback } from 'react';
import emailjs from '@emailjs/browser';
import {
  getScholarships, addScholarship, deleteScholarship,
  getApplications, addApplication, getSettings, saveSettings
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
    if (window.location.hash !== '#payment-return') return;
    const raw = sessionStorage.getItem('pendingApplication');
    const orderId = sessionStorage.getItem('pendingOrderId');
    if (!raw || !orderId) return;
    (async () => {
      const app = JSON.parse(raw);
      const status = await checkPaymentStatus(orderId);
      if (status === 'Success') {
        await addApplication(app);
        sendConfirmationEmail(app, settings);
        sessionStorage.removeItem('pendingApplication');
        sessionStorage.removeItem('pendingOrderId');
        window.location.hash = '';
        alert('Payment confirmed. Scholarship successfully applied. Please wait for the scholarship process.');
      } else {
        sessionStorage.removeItem('pendingApplication');
        sessionStorage.removeItem('pendingOrderId');
        window.location.hash = '';
        alert('Payment was not completed (' + status + '). Please apply again.');
      }
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
              <div className="co">{s.company || 'Sponsor'}</div>
              <h3>{s.title}</h3>
              <div className="desc">{s.description}</div>
              <div className="meta">
                <div className="amount">₹{Number(s.price || 0).toLocaleString('en-IN')}<br /><small>award amount</small></div>
                <button className="btn btn-primary" onClick={() => setOpenScholarship(s)}>Apply Now</button>
              </div>
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
    message: 'Scholarship successfully applied. Please wait for the scholarship process.'
  }).catch(() => {});
}

function ApplyModal({ scholarship, settings, onClose }) {
  const [form, setForm] = useState({
    gmail: '', phone: '', state: '', district: '', city: '', institute: '',
    aadharNumber: '', aadharName: '', aadharDob: ''
  });
  const [errors, setErrors] = useState({});
  const [stage, setStage] = useState('form'); // form | paying | done
  const [payMsg, setPayMsg] = useState('');

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const validate = () => {
    const e = {};
    if (!/^.+@gmail\.com$/.test(form.gmail)) e.gmail = 'Please enter a valid Gmail address.';
    if (!/^[0-9]{10}$/.test(form.phone)) e.phone = 'Enter a valid 10-digit phone number.';
    if (!/^[0-9]{12}$/.test(form.aadharNumber)) e.aadharNumber = 'Aadhaar number must be exactly 12 digits.';
    ['state', 'district', 'city', 'institute', 'aadharName', 'aadharDob'].forEach(k => {
      if (!form[k]) e[k] = 'Required';
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;

    const application = {
      id: 'APP-' + Date.now().toString(36).toUpperCase(),
      scholarshipId: scholarship.id,
      scholarshipTitle: scholarship.title,
      company: scholarship.company,
      ...form
    };

    const fee = Number(settings.feeAmount || 0);
    if (fee > 0) {
      setStage('paying');
      setPayMsg('Creating your payment order…');
      const orderId = 'ORD' + Date.now();
      sessionStorage.setItem('pendingApplication', JSON.stringify(application));
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
          setPayMsg('Could not start payment: ' + (data.message || 'unknown error'));
        }
      } catch (err) {
        setPayMsg('Could not reach the payment server. Please try again.');
      }
    } else {
      await addApplication(application);
      sendConfirmationEmail(application, settings);
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

                <div className="divider-label">Aadhaar details</div>
                <div className="form-row">
                  <label>Aadhaar Number <span className="req">*</span></label>
                  <input type="text" maxLength={12} value={form.aadharNumber} onChange={e => update('aadharNumber', e.target.value)} />
                  {errors.aadharNumber && <div className="err">{errors.aadharNumber}</div>}
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
            <div className="amt">₹{Number(settings.feeAmount).toLocaleString('en-IN')}</div>
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
  const [form, setForm] = useState({ title: '', company: '', price: '', deadline: '', description: '' });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title || !form.company || !form.price) return;
    await addScholarship({ ...form, price: Number(form.price) });
    setForm({ title: '', company: '', price: '', deadline: '', description: '' });
    onChange();
  };

  const remove = async (id) => {
    if (!confirm('Remove this scholarship listing?')) return;
    await deleteScholarship(id);
    onChange();
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
            <div className="form-row"><label>Deadline</label><input type="date" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} /></div>
            <div className="form-row full"><label>Description</label><textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          </div>
          <div className="btn-row"><button className="btn btn-accent" type="submit">Upload Scholarship</button></div>
        </form>
      </div>
      <div className="panel">
        <h2>Live listings</h2>
        <div className="scroll-x">
          <table>
            <thead><tr><th>Title</th><th>Company</th><th>Amount</th><th>Deadline</th><th></th></tr></thead>
            <tbody>
              {scholarships.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>No scholarships uploaded yet.</td></tr>}
              {scholarships.map(s => (
                <tr key={s.id}>
                  <td><strong>{s.title}</strong></td>
                  <td><span className="co-tag">{s.company}</span></td>
                  <td className="price">₹{Number(s.price).toLocaleString('en-IN')}</td>
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

function ApplicationsTab({ applications }) {
  return (
    <>
      <div className="page-head"><h1>Applications</h1><p>All applicant details submitted from the student portal.</p></div>
      <div className="panel">
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Ref</th><th>Scholarship</th><th>Gmail</th><th>Phone</th><th>State</th>
                <th>District</th><th>City</th><th>School/College</th><th>Aadhaar No.</th>
                <th>Aadhaar Name</th><th>Aadhaar DOB</th>
              </tr>
            </thead>
            <tbody>
              {applications.length === 0 && <tr><td colSpan={11} style={{ textAlign: 'center', color: 'var(--muted)' }}>No applications yet.</td></tr>}
              {applications.map(a => (
                <tr key={a.id}>
                  <td><span className="refid">{a.id}</span></td>
                  <td>{a.scholarshipTitle}</td>
                  <td>{a.gmail}</td>
                  <td>{a.phone}</td>
                  <td>{a.state}</td>
                  <td>{a.district}</td>
                  <td>{a.city}</td>
                  <td>{a.institute}</td>
                  <td className="mono">{a.aadharNumber}</td>
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
    await saveSettings({ ...form, feeAmount: Number(form.feeAmount) || 0 });
    onChange();
  };

  return (
    <>
      <div className="page-head"><h1>Settings</h1><p>Application fee and email confirmation setup.</p></div>
      <div className="panel">
        <h2>Application Fee</h2>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="form-row"><label>Fee Amount (₹)</label><input type="number" value={form.feeAmount} onChange={e => setForm(f => ({ ...f, feeAmount: e.target.value }))} placeholder="0 = free to apply" /></div>
          </div>
          <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--muted)' }}>
            The ZapUPI key itself is set separately as a server environment variable (ZAPUPI_KEY on Vercel) — it never lives in this form or in the code, so it stays private even though this repo is public.
          </div>

          <h2 style={{ marginTop: 26 }}>Email Confirmation (EmailJS)</h2>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
            Free account at emailjs.com → connect Gmail → create a template → paste the 3 values below.
          </div>
          <div className="form-grid">
            <div className="form-row"><label>EmailJS Public Key</label><input value={form.emailjsPublicKey} onChange={e => setForm(f => ({ ...f, emailjsPublicKey: e.target.value }))} /></div>
            <div className="form-row"><label>EmailJS Service ID</label><input value={form.emailjsServiceId} onChange={e => setForm(f => ({ ...f, emailjsServiceId: e.target.value }))} /></div>
            <div className="form-row full"><label>EmailJS Template ID</label><input value={form.emailjsTemplateId} onChange={e => setForm(f => ({ ...f, emailjsTemplateId: e.target.value }))} /></div>
          </div>
          <div className="btn-row"><button className="btn btn-accent" type="submit">Save Settings</button></div>
        </form>
      </div>
    </>
  );
}
