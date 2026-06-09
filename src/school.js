// School portal routes (kid model: school -> teacher -> student).
//
//   GET  /api/class-roster?code=CLASSCODE
//        -> { teacher, school, students:[{id, first_name}] }   (anon; what a kid sees after the QR)
//
//   POST /api/kid-signin   { studentId }
//        -> { access_token, refresh_token, ... }   (signs the kid's hidden account in)
//
//   POST /api/add-student  { classCode, firstName }   (staff/admin only)
//        -> creates the hidden account + grants Basic access + uses a seat
//
// Each kid gets an auto-made login like <uuid>@kids.lisaany.com with a random password
// stored (service-role-only) in students.login_pw. The child never sees either of them.

const KID_DOMAIN = 'kids.lisaany.com';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

// service-role headers — full read/write, bypasses RLS (same creds your webhook uses)
function svc(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

// public/publishable key — needed for the password sign-in + verifying a caller's token
function anonKey(env) {
  return env.SUPABASE_ANON_KEY || 'sb_publishable_JzVuIvyj2OEP4o0zbURcQA_NhfBFPaa';
}

// owner override: recognise the owner by email even if no admin role tag is set
function ownerEmails(env) {
  return (env.OWNER_EMAILS || 'ahmedstart163@gmail.com,admin@lisaany.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function isAdmin(me, env) {
  const role = me && me.app_metadata && me.app_metadata.role;
  const email = ((me && me.email) || '').toLowerCase();
  return role === 'admin' || ownerEmails(env).includes(email);
}
function isStaffOrAdmin(me, env) {
  const role = me && me.app_metadata && me.app_metadata.role;
  return role === 'staff' || isAdmin(me, env);
}

function randomPw() {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return 'K' + btoa(String.fromCharCode(...a)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) + '7!';
}

// ---------- 1) Class roster (anon) ----------
export async function handleClassRoster(request, env) {
  try {
    const url = new URL(request.url);
    const code = (url.searchParams.get('code') || '').trim();
    if (!code) return json({ error: 'Missing class code' }, 400);

    const tRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/teachers?class_code=eq.${encodeURIComponent(code)}&active=eq.true&select=id,name,school_id,course&limit=1`,
      { headers: svc(env) }
    );
    const teachers = await tRes.json();
    const teacher = Array.isArray(teachers) ? teachers[0] : null;
    if (!teacher) return json({ error: 'Class not found' }, 404);

    let schoolName = '';
    if (teacher.school_id) {
      const sRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/schools?id=eq.${teacher.school_id}&select=name&limit=1`,
        { headers: svc(env) }
      );
      const schools = await sRes.json();
      schoolName = (Array.isArray(schools) && schools[0]) ? schools[0].name : '';
    }

    const stRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/students?teacher_id=eq.${teacher.id}&select=id,first_name&order=first_name.asc`,
      { headers: svc(env) }
    );
    const students = await stRes.json();

    return json({
      teacher: teacher.name,
      school: schoolName,
      course: teacher.course || 'arabic',
      students: (Array.isArray(students) ? students : []).map((s) => ({ id: s.id, first_name: s.first_name })),
    });
  } catch (err) {
    console.error('class-roster error:', err);
    return json({ error: 'Server error' }, 500);
  }
}

// ---------- 2) Kid sign-in ----------
export async function handleKidSignin(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const { studentId } = await request.json();
    if (!studentId) return json({ error: 'Missing studentId' }, 400);

    const sRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/students?id=eq.${encodeURIComponent(studentId)}&select=id,user_id,login_pw&limit=1`,
      { headers: svc(env) }
    );
    const rows = await sRes.json();
    const student = Array.isArray(rows) ? rows[0] : null;
    if (!student || !student.user_id || !student.login_pw) return json({ error: 'Student not set up' }, 404);

    const email = `${student.id}@${KID_DOMAIN}`;
    const tokRes = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: student.login_pw }),
    });
    const tok = await tokRes.json();
    if (!tokRes.ok || !tok.access_token) return json({ error: 'Sign-in failed' }, 401);

    return json({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_in: tok.expires_in,
      expires_at: tok.expires_at,
      token_type: tok.token_type,
    });
  } catch (err) {
    console.error('kid-signin error:', err);
    return json({ error: 'Server error' }, 500);
  }
}

// ---------- 3) Add a student (staff/admin only) ----------
export async function handleAddStudent(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    // verify the caller is a signed-in staff or admin
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Not authorized' }, 401);
    const meRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: anonKey(env), Authorization: `Bearer ${jwt}` },
    });
    const me = await meRes.json();
    if (!meRes.ok || !me.id) return json({ error: 'Not authorized' }, 401);

    const { classCode, firstName } = await request.json();
    if (!classCode || !firstName) return json({ error: 'Missing classCode or firstName' }, 400);

    // find the teacher + their school
    const tRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/teachers?class_code=eq.${encodeURIComponent(classCode)}&select=id,school_id,user_id&limit=1`,
      { headers: svc(env) }
    );
    const teacher = (await tRes.json())[0];
    if (!teacher) return json({ error: 'Class not found' }, 404);
    if (!isAdmin(me, env) && teacher.user_id !== me.id) return json({ error: 'Not your class' }, 403);

    const schRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/schools?id=eq.${teacher.school_id}&select=id,seats,active,expires_at&limit=1`,
      { headers: svc(env) }
    );
    const school = (await schRes.json())[0];
    if (!school || school.active === false) return json({ error: 'School inactive' }, 403);

    // seat check: count students across all teachers in this school
    const tlRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/teachers?school_id=eq.${school.id}&select=id`,
      { headers: svc(env) }
    );
    const tids = (await tlRes.json()).map((t) => t.id);
    let used = 0;
    if (tids.length) {
      const cntRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/students?teacher_id=in.(${tids.join(',')})&select=id`,
        { headers: svc(env) }
      );
      used = (await cntRes.json()).length;
    }
    if (used >= (school.seats || 0)) return json({ error: 'No seats left' }, 403);

    // 1. create the student row (gives us an id we can build the login from)
    const id = crypto.randomUUID();
    const pw = randomPw();
    const insRes = await fetch(`${env.SUPABASE_URL}/rest/v1/students`, {
      method: 'POST',
      headers: { ...svc(env), Prefer: 'return=minimal' },
      body: JSON.stringify({ id, teacher_id: teacher.id, first_name: firstName, login_pw: pw }),
    });
    if (!insRes.ok) {
      console.error('student insert', await insRes.text());
      return json({ error: 'Could not add student' }, 500);
    }

    // 2. create the hidden auth account
    const email = `${id}@${KID_DOMAIN}`;
    const auRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: svc(env),
      body: JSON.stringify({ email, password: pw, email_confirm: true, user_metadata: { name: firstName, kind: 'student' } }),
    });
    const au = await auRes.json();
    if (!auRes.ok || !au.id) {
      console.error('auth create', au);
      return json({ error: 'Could not create login' }, 500);
    }

    // 3. link the auth account back to the student row
    await fetch(`${env.SUPABASE_URL}/rest/v1/students?id=eq.${id}`, {
      method: 'PATCH',
      headers: svc(env),
      body: JSON.stringify({ user_id: au.id }),
    });

    // 4. grant Basic (self_paced/active) so the paywall unlocks; follow the school term if set
    let periodEnd = null;
    if (school.expires_at) {
      const d = new Date(school.expires_at + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1);
      periodEnd = d.toISOString();
    }
    await fetch(`${env.SUPABASE_URL}/rest/v1/subscriptions`, {
      method: 'POST',
      headers: { ...svc(env), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: au.id,
        stripe_customer_id: 'school_' + au.id,
        stripe_subscription_id: 'school_' + au.id,
        plan: 'self_paced',
        status: 'active',
        current_period_end: periodEnd,
        cancel_at_period_end: false,
      }),
    });

    return json({ ok: true, student: { id, first_name: firstName } });
  } catch (err) {
    console.error('add-student error:', err);
    return json({ error: 'Server error' }, 500);
  }
}

// ---------- 4) Create a class = school + first teacher (admin only) ----------
function slugify(s) {
  return ((s || 'class').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 12)) || 'class';
}
function code4() {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const a = new Uint8Array(4);
  crypto.getRandomValues(a);
  let r = '';
  for (const x of a) r += c[x % 36];
  return r;
}

export async function handleCreateClass(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Not authorized' }, 401);
    const meRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: anonKey(env), Authorization: `Bearer ${jwt}` },
    });
    const me = await meRes.json();
    if (!meRes.ok || !isAdmin(me, env)) return json({ error: 'Admin only' }, 403);

    const { schoolName, seats, expiresAt, teacherName, course } = await request.json();
    if (!schoolName || !teacherName) return json({ error: 'Missing schoolName or teacherName' }, 400);
    const seatCount = Math.max(0, parseInt(seats, 10) || 0);
    const courseVal = (course === 'norania') ? 'norania' : 'arabic';

    // create the school
    const schRes = await fetch(`${env.SUPABASE_URL}/rest/v1/schools`, {
      method: 'POST',
      headers: { ...svc(env), Prefer: 'return=representation' },
      body: JSON.stringify({ name: schoolName, seats: seatCount, active: true, expires_at: expiresAt || null, join_code: 'sch-' + code4() + code4() }),
    });
    const schText = await schRes.text();
    let sch = null;
    try { sch = JSON.parse(schText)[0]; } catch (e) {}
    if (!schRes.ok || !sch) { console.error('school insert', schText); return json({ error: 'Could not create school', detail: schText.slice(0, 300) }, 500); }

    // create the teacher with a unique class code (retry on the rare collision)
    let teacher = null, lastErr = null;
    for (let i = 0; i < 4 && !teacher; i++) {
      const code = slugify(teacherName) + '-' + code4();
      const claim = code4() + code4();
      const tRes = await fetch(`${env.SUPABASE_URL}/rest/v1/teachers`, {
        method: 'POST',
        headers: { ...svc(env), Prefer: 'return=representation' },
        body: JSON.stringify({ school_id: sch.id, name: teacherName, class_code: code, claim_code: claim, course: courseVal }),
      });
      if (tRes.ok) { teacher = (await tRes.json())[0]; }
      else { lastErr = await tRes.text(); }
    }
    if (!teacher) { console.error('teacher insert', lastErr); return json({ error: 'Could not create class', detail: (lastErr || '').slice(0, 300) }, 500); }

    return json({ ok: true, school: { id: sch.id, name: sch.name, seats: sch.seats }, class_code: teacher.class_code, claim_code: teacher.claim_code, teacher: teacher.name });
  } catch (err) {
    console.error('create-class error:', err);
    return json({ error: 'Server error' }, 500);
  }
}

// ---------- 5) List all schools (admin) ----------
export async function handleListSchools(request, env) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  try {
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Not authorized' }, 401);
    const meRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: anonKey(env), Authorization: `Bearer ${jwt}` } });
    const me = await meRes.json();
    if (!meRes.ok || !isAdmin(me, env)) return json({ error: 'Admin only' }, 403);

    const [sRes, tRes, stRes] = await Promise.all([
      fetch(`${env.SUPABASE_URL}/rest/v1/schools?select=id,name,seats,active,expires_at,created_at&order=created_at.desc`, { headers: svc(env) }),
      fetch(`${env.SUPABASE_URL}/rest/v1/teachers?select=id,school_id,name,class_code,claim_code`, { headers: svc(env) }),
      fetch(`${env.SUPABASE_URL}/rest/v1/students?select=teacher_id`, { headers: svc(env) }),
    ]);
    const schools = await sRes.json();
    const teachers = await tRes.json();
    const students = await stRes.json();

    const schoolByTeacher = {}, tCount = {}, stCount = {};
    (teachers || []).forEach((t) => { schoolByTeacher[t.id] = t.school_id; tCount[t.school_id] = (tCount[t.school_id] || 0) + 1; });
    (students || []).forEach((s) => { const sc = schoolByTeacher[s.teacher_id]; if (sc) stCount[sc] = (stCount[sc] || 0) + 1; });

    const out = (Array.isArray(schools) ? schools : []).map((s) => ({
      id: s.id, name: s.name, seats: s.seats, active: s.active, expires_at: s.expires_at,
      teacher_count: tCount[s.id] || 0, student_count: stCount[s.id] || 0,
      classes: (teachers || []).filter((t) => t.school_id === s.id).map((t) => ({ name: t.name, class_code: t.class_code, claim_code: t.claim_code })),
    }));
    return json({ schools: out });
  } catch (err) {
    console.error('list-schools error:', err);
    return json({ error: 'Server error' }, 500);
  }
}

// ---------- 6) Delete a school + everything under it (admin) ----------
export async function handleDeleteSchool(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Not authorized' }, 401);
    const meRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: anonKey(env), Authorization: `Bearer ${jwt}` } });
    const me = await meRes.json();
    if (!meRes.ok || !isAdmin(me, env)) return json({ error: 'Admin only' }, 403);

    const { schoolId } = await request.json();
    if (!schoolId) return json({ error: 'Missing schoolId' }, 400);

    // gather every kid account under this school
    const tRes = await fetch(`${env.SUPABASE_URL}/rest/v1/teachers?school_id=eq.${schoolId}&select=id`, { headers: svc(env) });
    const tids = (await tRes.json()).map((t) => t.id);
    let userIds = [];
    if (tids.length) {
      const stRes = await fetch(`${env.SUPABASE_URL}/rest/v1/students?teacher_id=in.(${tids.join(',')})&select=user_id`, { headers: svc(env) });
      userIds = (await stRes.json()).map((s) => s.user_id).filter(Boolean);
    }
    // remove each kid's hidden account + their access row
    for (const uid of userIds) {
      await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: svc(env) });
      await fetch(`${env.SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${uid}`, { method: 'DELETE', headers: svc(env) });
    }
    // delete the school — teachers + students rows cascade away with it
    const dRes = await fetch(`${env.SUPABASE_URL}/rest/v1/schools?id=eq.${schoolId}`, { method: 'DELETE', headers: svc(env) });
    if (!dRes.ok) return json({ error: 'Could not delete school', detail: (await dRes.text()).slice(0, 300) }, 500);

    return json({ ok: true, removed_students: userIds.length });
  } catch (err) {
    console.error('delete-school error:', err);
    return json({ error: 'Server error' }, 500);
  }
}

// ---------- 7) Remove a single student (admin/staff) ----------
export async function handleRemoveStudent(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Not authorized' }, 401);
    const meRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: anonKey(env), Authorization: `Bearer ${jwt}` } });
    const me = await meRes.json();
    if (!meRes.ok || !me.id) return json({ error: 'Not authorized' }, 401);

    const { studentId } = await request.json();
    if (!studentId) return json({ error: 'Missing studentId' }, 400);

    const sRes = await fetch(`${env.SUPABASE_URL}/rest/v1/students?id=eq.${encodeURIComponent(studentId)}&select=user_id,teacher_id`, { headers: svc(env) });
    const st = (await sRes.json())[0];
    if (!st) return json({ error: 'Student not found' }, 404);

    // only the class's own teacher (or admin) may remove
    const tRes = await fetch(`${env.SUPABASE_URL}/rest/v1/teachers?id=eq.${st.teacher_id}&select=user_id&limit=1`, { headers: svc(env) });
    const teacher = (await tRes.json())[0];
    if (!isAdmin(me, env) && (!teacher || teacher.user_id !== me.id)) return json({ error: 'Not your class' }, 403);

    if (st.user_id) {
      await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${st.user_id}`, { method: 'DELETE', headers: svc(env) });
      await fetch(`${env.SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${st.user_id}`, { method: 'DELETE', headers: svc(env) });
    }
    await fetch(`${env.SUPABASE_URL}/rest/v1/students?id=eq.${encodeURIComponent(studentId)}`, { method: 'DELETE', headers: svc(env) });
    return json({ ok: true });
  } catch (err) {
    console.error('remove-student error:', err);
    return json({ error: 'Server error' }, 500);
  }
}

// ---------- 8) Teacher claims a class with a private claim code ----------
export async function handleClaimClass(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Please sign in first' }, 401);
    const meRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: anonKey(env), Authorization: `Bearer ${jwt}` } });
    const me = await meRes.json();
    if (!meRes.ok || !me.id) return json({ error: 'Please sign in first' }, 401);

    const { claimCode } = await request.json();
    if (!claimCode) return json({ error: 'Missing claim code' }, 400);

    const tRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/teachers?claim_code=eq.${encodeURIComponent(claimCode.trim())}&select=id,name,class_code,user_id&limit=1`,
      { headers: svc(env) }
    );
    const teacher = (await tRes.json())[0];
    if (!teacher) return json({ error: 'That code is not valid' }, 404);
    if (teacher.user_id && teacher.user_id !== me.id) return json({ error: 'This class is already claimed by another account' }, 409);

    if (!teacher.user_id) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/teachers?id=eq.${teacher.id}`, {
        method: 'PATCH', headers: svc(env), body: JSON.stringify({ user_id: me.id }),
      });
    }
    return json({ ok: true, class_code: teacher.class_code, teacher: teacher.name });
  } catch (err) {
    console.error('claim-class error:', err);
    return json({ error: 'Server error' }, 500);
  }
}

// ---------- 9) Teacher loads their own class(es) ----------
export async function handleMyClass(request, env) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  try {
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Please sign in first' }, 401);
    const meRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: anonKey(env), Authorization: `Bearer ${jwt}` } });
    const me = await meRes.json();
    if (!meRes.ok || !me.id) return json({ error: 'Please sign in first' }, 401);

    const tRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/teachers?user_id=eq.${me.id}&select=id,name,class_code,school_id&order=created_at.asc`,
      { headers: svc(env) }
    );
    const teachers = await tRes.json();
    if (!Array.isArray(teachers) || !teachers.length) return json({ claimed: false, classes: [] });

    const classes = [];
    for (const t of teachers) {
      let schoolName = '', seats = 0;
      if (t.school_id) {
        const sRes = await fetch(`${env.SUPABASE_URL}/rest/v1/schools?id=eq.${t.school_id}&select=name,seats&limit=1`, { headers: svc(env) });
        const s = (await sRes.json())[0];
        if (s) { schoolName = s.name; seats = s.seats; }
      }
      const stRes = await fetch(`${env.SUPABASE_URL}/rest/v1/students?teacher_id=eq.${t.id}&select=id,first_name&order=first_name.asc`, { headers: svc(env) });
      const students = await stRes.json();
      classes.push({
        class_code: t.class_code, teacher: t.name, school: schoolName, seats,
        students: (Array.isArray(students) ? students : []).map((s) => ({ id: s.id, first_name: s.first_name })),
      });
    }
    return json({ claimed: true, classes });
  } catch (err) {
    console.error('my-class error:', err);
    return json({ error: 'Server error' }, 500);
  }
}
