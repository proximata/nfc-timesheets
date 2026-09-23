import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Called by the disposable two-company integration fixture, through real HTTP/RLS.
export async function checkProductFeatures({
  call,
  owner,
  a,
  b,
  platform,
  resetLoginRate,
}) {
  const lead = {
    email: "Office@Example.test",
    company: "Example Cleaning",
    locale: "en",
  };
  assert.equal(
    (await call("/public/trial-requests", { body: lead })).status,
    202,
  );
  assert.equal(
    (await call("/public/trial-requests", { body: lead })).status,
    202,
  );
  assert.equal(
    (await call("/platform/trial-requests", { cookie: a.cookie })).status,
    401,
  );
  assert.equal((await call("/platform/trial-requests")).status, 401);
  const inbox = await call("/platform/trial-requests", {
    cookie: platform.cookie,
  });
  assert.equal(inbox.data.requests.length, 1);
  assert.equal(inbox.data.requests[0].email, "office@example.test");
  assert.equal(
    (
      await call("/public/trial-requests", {
        body: { ...lead, email: "broken" },
      })
    ).status,
    422,
  );
  for (let i = 0; i < 2; i++)
    await call("/public/trial-requests", { body: lead });
  assert.equal(
    (await call("/public/trial-requests", { body: lead })).status,
    429,
  );
  resetLoginRate();

  const starts = new Date(Date.now() + 86400000);
  starts.setUTCMinutes(0, 0, 0);
  const at = (hours) =>
    new Date(starts.getTime() + hours * 3600000).toISOString();
  const plan = {
    id: randomUUID(),
    worker_id: a.worker.id,
    location_id: a.location.id,
    starts_at: at(0),
    ends_at: at(2),
    note: "Morning cleaning",
  };
  const before = Number(
    (await owner.query("SELECT count(*) FROM shifts")).rows[0].count,
  );
  assert.equal((await call("/admin/schedule", { body: plan })).status, 401);
  assert.equal(
    (await call("/admin/schedule", { cookie: platform.cookie, body: plan }))
      .status,
    401,
  );
  assert.equal(
    (await call("/admin/schedule", { cookie: b.cookie, body: plan })).status,
    404,
  );
  assert.equal(
    (
      await call("/admin/schedule", {
        cookie: a.cookie,
        body: { ...plan, location_id: b.location.id },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call("/admin/schedule", {
        cookie: a.cookie,
        body: { ...plan, ends_at: at(-1) },
      })
    ).status,
    400,
  );
  const created = await call("/admin/schedule", {
    cookie: a.cookie,
    body: plan,
  });
  assert.equal(created.status, 201, JSON.stringify(created));
  assert.equal(
    (await call("/admin/schedule", { cookie: a.cookie, body: plan })).status,
    200,
  );
  assert.equal(
    (
      await call("/admin/schedule", {
        cookie: a.cookie,
        body: { ...plan, note: "Changed retry" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call("/admin/schedule", {
        cookie: a.cookie,
        body: { ...plan, id: randomUUID(), starts_at: at(1) },
      })
    ).data.error,
    "schedule_overlap",
  );
  const path = "/admin/schedule/" + plan.id;
  assert.equal(
    (
      await call(path, {
        cookie: b.cookie,
        method: "PUT",
        body: { ...plan, version: 1 },
      })
    ).status,
    404,
  );
  const edit = await call(path, {
    cookie: a.cookie,
    method: "PUT",
    body: { ...plan, note: "Bring keys", version: 1 },
  });
  assert.equal(edit.status, 200);
  assert.equal(edit.data.assignment.version, 2);
  assert.equal(
    (
      await call(path, {
        cookie: a.cookie,
        method: "PUT",
        body: { ...plan, version: 1 },
      })
    ).data.error,
    "schedule_changed",
  );
  const range = new URLSearchParams({ from: at(-24), to: at(48) });
  assert.equal(
    (await call("/admin/schedule?" + range, { cookie: b.cookie })).data
      .assignments.length,
    0,
  );
  assert.equal(
    (await call("/admin/schedule?" + range, { cookie: a.cookie })).data
      .assignments.length,
    1,
  );
  assert.equal(
    (await call("/me/schedule", { cookie: a.workerCookie })).data.assignments[0]
      .note,
    "Bring keys",
  );
  assert.equal(
    (
      await call("/me/schedule?worker_id=" + a.worker.id, {
        cookie: b.workerCookie,
      })
    ).data.assignments.length,
    0,
  );
  assert.equal(
    (await call(path + "/cancel", { cookie: b.cookie, body: { version: 2 } }))
      .status,
    404,
  );
  assert.equal(
    (await call(path + "/cancel", { cookie: a.cookie, body: { version: 1 } }))
      .status,
    409,
  );
  assert.equal(
    (await call(path + "/cancel", { cookie: a.cookie, body: { version: 2 } }))
      .status,
    200,
  );
  assert.equal(
    (await call("/me/schedule", { cookie: a.workerCookie })).data.assignments
      .length,
    0,
  );
  assert.ok(
    (await call("/admin/schedule?" + range, { cookie: a.cookie })).data
      .assignments[0].cancelled_at,
  );
  const race = await Promise.all(
    [1, 2].map(() =>
      call("/admin/schedule", {
        cookie: a.cookie,
        body: { ...plan, id: randomUUID() },
      }),
    ),
  );
  assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
  // Adjacent half-open plans are allowed; no hour is counted twice by overlap checks.
  assert.equal(
    (
      await call("/admin/schedule", {
        cookie: a.cookie,
        body: { ...plan, id: randomUUID(), starts_at: at(2), ends_at: at(4) },
      })
    ).status,
    201,
  );
  assert.equal(
    Number((await owner.query("SELECT count(*) FROM shifts")).rows[0].count),
    before,
    "planning must never create actual work",
  );
  console.log(
    "check-product-features: PASS (leads, rate limit, role isolation, schedule CRUD, worker isolation, optimistic concurrency, overlap race, actual-shift independence)",
  );
}
