#!/usr/bin/env python3
"""One-shot updater for the Leave Policy wiki page."""
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
from database import create_database

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

CONTENT_HTML = """<h1>Attendance &amp; Leave Policy</h1>
<p class="text-lg text-slate-300 mb-2">Document: <strong>GRT/ALP/POL/V-2</strong> · Effective: <strong>1st June 2026</strong></p>
<p class="text-slate-400 mb-8">The complete attendance, leave, and work-discipline framework for all on-roll employees of Ethara AI.</p>

<div class="bg-primary/10 border border-primary/30 rounded-lg p-5 mb-8">
  <h3 class="text-primary font-bold mb-2">Purpose</h3>
  <p class="text-slate-300">This policy outlines the attendance, leave, and work discipline framework applicable to employees of Ethara AI. The objective is to ensure operational continuity, workforce planning, compliance, accountability, and transparent leave management across the organization. All employees are expected to adhere strictly to the attendance and leave procedures mentioned herein.</p>
</div>

<h2>Scope</h2>
<p class="mb-6">This policy shall be applicable to <strong>all on-roll employees</strong> of Ethara AI.</p>

<h2>Attendance Protocol</h2>

<h3>General Attendance Guidelines</h3>
<ul>
  <li>All employees are required to mark attendance through the <strong>biometric attendance system</strong> only.</li>
  <li><strong>Working Days:</strong> Monday to Friday.</li>
  <li>No other source/mode of attendance shall be considered valid unless approved by HR.</li>
  <li><strong>Official working hours:</strong> 10:00 AM to 7:00 PM.</li>
  <li>One-hour break shall be allowed for lunch/refreshments.</li>
  <li>Employees are required to complete <strong>9 working hours daily</strong>.</li>
  <li>A grace period of <strong>30 minutes</strong> shall be applicable.</li>
</ul>
<div class="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6">
  <p class="text-amber-200"><strong>Note:</strong> Saturdays and Sundays shall generally be considered weekly offs. However, employees may be required to work on such days depending upon operational and business requirements, with attendance/compensatory arrangements being managed wherever applicable.</p>
</div>

<h3>Late Coming Guidelines</h3>
<ul>
  <li>Employees reporting between <strong>10:30 AM and 11:30 AM</strong> shall be marked as <strong>Late Comers</strong>.</li>
  <li>Up to <strong>3 late-coming instances</strong> shall be permitted in a month.</li>
  <li>From the <strong>4th instance onwards</strong>, disciplinary action including warning letters and/or Leave without Pay (LOP) may be initiated.</li>
  <li>Employees reporting <strong>after 11:30 AM</strong> without prior approval/intimation shall be marked <strong>Absent</strong> for the day.</li>
</ul>

<h3>Extended Working Exception</h3>
<p class="mb-3">For employees working till late due to business requirements, the reporting manager must intimate HR on the same day mentioning:</p>
<ul>
  <li>Employee Name</li>
  <li>Employee Code</li>
  <li>Expected reporting time for the next day</li>
</ul>
<p class="mb-6">If the employee reports later than the approved time, the employee shall be marked <strong>Absent</strong>.</p>

<h3>Night Shift / Overnight Work</h3>
<p class="mb-3">In case an employee works overnight/night shift due to business requirements, the reporting manager must clearly intimate whether the employee:</p>
<ul>
  <li>Will report late, or</li>
  <li>Will not report to the office and is required to be marked as <strong>Present / WFH / Leave</strong> accordingly.</li>
</ul>

<h3>Attendance Corrections</h3>
<ul>
  <li>Any biometric-related issue must be reported to HR through <strong>official email only</strong>.</li>
  <li>Verbal attendance regularization requests shall not be entertained.</li>
</ul>

<h2>Public Holidays</h2>
<ul>
  <li>Employees shall be entitled to <strong>National Holidays</strong> and <strong>Festival Holidays</strong> as declared by the Company in accordance with applicable laws and business requirements.</li>
  <li>The holiday calendar shall be communicated separately by HR every calendar year.</li>
</ul>

<h2>Leave Cycle</h2>
<div class="bg-primary/10 border border-primary/30 rounded-lg p-4 mb-6">
  <p class="text-primary"><strong>The leave cycle shall be considered from January to December every calendar year.</strong></p>
</div>

<h2>Leave Application Process</h2>

<h3>General Leave Guidelines</h3>
<ul>
  <li>All leave applications must mandatorily be submitted through <strong>GreytHR</strong>.</li>
  <li>Email, Slack, WhatsApp, verbal approvals, or informal communication shall <strong>not</strong> be treated as valid leave approval.</li>
  <li>Leave approval shall be subject to reporting manager approval, business requirements, and workforce availability.</li>
  <li>Unauthorized absence or absence without approval/intimation may result in <strong>Leave without Pay (LOP)</strong> and disciplinary action.</li>
</ul>

<h3>Operations Team Leave Approval</h3>
<ul>
  <li>For Operations Teams, leave requests shall additionally be subject to consolidated approval from the <strong>CTO/COO</strong> for attendance and payroll processing purposes.</li>
  <li>Employees are expected to keep their respective reporting managers informed and aligned while planning leaves.</li>
  <li>Any leave not approved during such consolidated review shall be treated as <strong>Leave without Pay (LOP)</strong>, irrespective of prior informal discussion/intimation.</li>
  <li>Leave is <strong>not a matter of right</strong> and may be approved/rejected based on business exigencies, operational requirements, employee availability, and workflow dependency.</li>
</ul>

<h3>Leave Planning Guidelines</h3>
<ul>
  <li><strong>Earned Leave (EL)</strong> must be applied minimum <strong>3 days in advance</strong>.</li>
  <li><strong>Casual Leave (CL)</strong> and <strong>Sick Leave (SL)</strong> may be applied on the same day only in genuine emergency situations.</li>
  <li>Employees are expected to plan leaves responsibly to avoid operational disruptions.</li>
</ul>

<h2>Leave Types &amp; Entitlements</h2>

<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
  <div class="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
    <p class="text-xs uppercase tracking-wider text-primary font-semibold mb-1">Earned Leave</p>
    <p class="text-3xl font-bold text-white">18</p>
    <p class="text-xs text-slate-400 mt-1">days / year, monthly accrual</p>
  </div>
  <div class="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
    <p class="text-xs uppercase tracking-wider text-primary font-semibold mb-1">Casual Leave</p>
    <p class="text-3xl font-bold text-white">7</p>
    <p class="text-xs text-slate-400 mt-1">days / year, half-yearly credit</p>
  </div>
  <div class="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
    <p class="text-xs uppercase tracking-wider text-primary font-semibold mb-1">Sick Leave</p>
    <p class="text-3xl font-bold text-white">7</p>
    <p class="text-xs text-slate-400 mt-1">days / year, annual credit</p>
  </div>
</div>

<h3>a. Earned Leave (EL)</h3>
<ul>
  <li>Employees shall be entitled to <strong>18 Earned Leaves (ELs) annually</strong>.</li>
  <li>EL shall be credited <strong>monthly on a prorated basis</strong> depending upon the employee's Date of Joining (DOJ).</li>
  <li>EL shall be credited at the beginning of every month.</li>
  <li>Employees serving probation shall also be eligible to avail EL.</li>
  <li>EL may only be availed as <strong>Full Day Leave</strong>.</li>
  <li>EL may be clubbed with CL or SL, subject to approval.</li>
</ul>

<h4 class="text-primary">EL Carry Forward &amp; Encashment</h4>
<ul>
  <li>Unutilized Earned Leave (EL) shall be eligible for carry forward in accordance with <strong>Haryana Shops &amp; Commercial Establishments</strong> provisions.</li>
  <li>A maximum of <strong>30 ELs</strong> may be carried forward to the next calendar year. Any balance beyond this limit may lapse subject to applicable law and company policy.</li>
  <li>EL encashment shall only be applicable at the time of separation from the organization.</li>
  <li>Encashment shall be subject to Company policy and statutory compliance applicable at the time of separation.</li>
</ul>

<h4 class="text-primary">EL Transition Provision</h4>
<ul>
  <li>Since the revised EL structure is being implemented <strong>effective 1st June 2026</strong>, existing employees shall receive EL credit proportionately from the effective date onwards.</li>
  <li>New joiners shall receive prorated EL credit based on their Date of Joining (DOJ).</li>
</ul>

<h3>b. Casual Leave (CL)</h3>
<ul>
  <li>Employees shall be entitled to <strong>7 Casual Leaves (CLs) annually</strong>.</li>
  <li>CL shall be credited on a <strong>half-yearly basis</strong> and on a prorated basis depending upon the employee's Date of Joining (DOJ).</li>
  <li>Employees serving probation shall <strong>not</strong> be eligible for Casual Leave.</li>
  <li>CL is intended for urgent and unforeseen personal requirements only.</li>
  <li>More than <strong>3 consecutive CLs</strong> shall not be permitted.</li>
  <li>CL may be availed as <strong>Half Day or Full Day</strong> Leave.</li>
  <li>CL <strong>cannot</strong> be clubbed with Sick Leave (SL).</li>
  <li>CL may be clubbed with Earned Leave (EL), subject to approval.</li>
  <li>Unused CL balance shall <strong>lapse</strong> at the end of the calendar year.</li>
</ul>

<h3>c. Sick Leave (SL)</h3>
<ul>
  <li>Employees shall be entitled to <strong>7 Sick Leaves (SLs) annually</strong>.</li>
  <li>SL shall be credited <strong>yearly on a prorated basis</strong> depending upon the employee's Date of Joining (DOJ).</li>
  <li>Employees serving probation shall be eligible to avail Sick Leave.</li>
  <li>SL may be applied on the same day only in genuine medical/emergency situations.</li>
  <li>More than <strong>3 consecutive Sick Leaves</strong> shall require supporting medical documentation from a registered medical practitioner.</li>
  <li>Medical documents must be submitted along with the leave application for leave exceeding 3 days.</li>
  <li>Failure to provide required documentation may result in <strong>Leave without Pay (LOP)</strong>.</li>
  <li>SL <strong>cannot</strong> be clubbed with Casual Leave (CL).</li>
  <li>SL may be clubbed with Earned Leave (EL), subject to approval.</li>
  <li>Unused SL balance shall <strong>lapse</strong> at the end of the calendar year.</li>
</ul>

<h2>Special Leaves</h2>

<h3>a. Maternity Leave</h3>
<ul>
  <li>All eligible female employees shall be eligible for Maternity Leave in accordance with the <strong>Maternity Benefit Act, 1961</strong> and applicable amendments.</li>
  <li>Eligible employees shall be entitled to:
    <ul>
      <li>Up to <strong>26 weeks</strong> of paid maternity leave for the first two surviving children.</li>
      <li>Up to <strong>12 weeks</strong> of paid maternity leave if the employee already has two or more surviving children.</li>
    </ul>
  </li>
  <li>Maternity Leave may be availed up to <strong>8 weeks prior</strong> to the expected delivery date, with the remaining balance being availed post childbirth.</li>
  <li>Employees shall be required to intimate HR in advance along with supporting medical documentation.</li>
  <li>In the event of <strong>miscarriage or medical termination of pregnancy</strong>, eligible female employees having less than two surviving children shall be entitled to up to <strong>6 weeks</strong> of leave immediately following the date of miscarriage or medical termination, subject to medical advice, supporting documentation, and HR/management approval, in accordance with applicable statutory provisions.</li>
  <li>Eligible female employees having less than two surviving children and <strong>legally adopting an infant child below the age of 3 months</strong> shall be eligible for up to <strong>12 weeks</strong> of leave from the date of adoption, subject to submission of valid adoption/legal documents and HR/management approval, in accordance with applicable statutory provisions.</li>
</ul>

<h3>b. Paternity Leave</h3>
<ul>
  <li>All eligible male employees shall be eligible for <strong>5 working days</strong> of Paternity Leave.</li>
  <li>Paternity Leave must generally be availed within <strong>30 days</strong> of childbirth/adoption.</li>
</ul>

<h3>c. Bereavement Leave</h3>
<ul>
  <li>Employees shall be eligible for up to <strong>3 working days</strong> of Bereavement Leave in the unfortunate event of demise of an immediate family member.</li>
</ul>

<h3>d. Marriage Leave</h3>
<ul>
  <li>Employees shall be eligible for <strong>5 working days</strong> of Marriage Leave during their tenure with the organization.</li>
  <li>Marriage Leave may be availed <strong>only once</strong> during employment with the Company.</li>
</ul>

<h2>Leave Combination Rules</h2>
<div class="overflow-x-auto my-6">
  <table class="min-w-full border-collapse">
    <thead>
      <tr class="border-b border-zinc-700">
        <th class="text-left py-3 px-4 text-primary font-semibold">Leave Combination</th>
        <th class="text-left py-3 px-4 text-primary font-semibold">Status</th>
      </tr>
    </thead>
    <tbody>
      <tr class="border-b border-zinc-800/60">
        <td class="py-3 px-4 text-slate-200">CL + SL</td>
        <td class="py-3 px-4"><span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30">Not Allowed</span></td>
      </tr>
      <tr class="border-b border-zinc-800/60">
        <td class="py-3 px-4 text-slate-200">EL + CL</td>
        <td class="py-3 px-4"><span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Allowed</span></td>
      </tr>
      <tr>
        <td class="py-3 px-4 text-slate-200">EL + SL</td>
        <td class="py-3 px-4"><span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Allowed</span></td>
      </tr>
    </tbody>
  </table>
</div>

<h2>Compliance &amp; Discipline</h2>
<ul>
  <li>Only GreytHR entries and HR-approved leaves shall be considered valid for attendance and payroll processing.</li>
  <li>Any unauthorized absence, misuse of leave provisions, attendance manipulation, or repeated non-compliance may attract disciplinary action.</li>
  <li>Repeated attendance violations may result in warning letters, Leave without Pay (LOP), or further disciplinary measures as deemed appropriate by management.</li>
  <li>Employees and reporting managers are expected to ensure proper leave planning, attendance discipline, and timely communication.</li>
</ul>

<h2>Additional Workplace Flexibility</h2>
<p class="text-slate-400 mb-4 italic">(Subject to Management Approval)</p>

<h3>Work From Home (WFH)</h3>
<ul>
  <li>Employees may be permitted up to <strong>2 Work From Home (WFH) days per month</strong> subject to reporting manager approval, business requirements and management discretion. WFH shall <strong>not</strong> be treated as an entitlement.</li>
</ul>

<h3>Menstruation Leave</h3>
<ul>
  <li>Female employees may be permitted <strong>1 Menstruation Leave per month</strong> subject to prior intimation, approval &amp; management discretion.</li>
</ul>

<h2>Policy Governance</h2>
<ul>
  <li>This policy shall be governed in accordance with applicable labour laws, <strong>Haryana Shops &amp; Commercial Establishments</strong> provisions, and organizational requirements.</li>
  <li>The Company reserves the right to amend, interpret, modify, suspend, or withdraw any provision of this policy at any time based on business requirements, operational considerations, or legal amendments.</li>
</ul>

<h2>Conclusion</h2>
<p class="mb-3">Employees are expected to exercise responsibility, professionalism, and discipline while availing attendance flexibility and leave benefits.</p>
<p class="mb-3">The objective of this policy is to ensure:</p>
<ul>
  <li>Transparent attendance and leave management</li>
  <li>Operational continuity</li>
  <li>Better workforce planning</li>
  <li>Payroll accuracy</li>
  <li>Improved accountability across teams</li>
</ul>

<div class="bg-primary/10 border border-primary/30 rounded-lg p-5 mt-8">
  <p class="text-slate-300">For any clarification regarding this policy, employees may connect with the <strong class="text-primary">HR Team</strong>.</p>
  <p class="text-xs text-slate-500 mt-2">The policy is subject to revision at the company's discretion and will be communicated accordingly.</p>
</div>
"""

# Plain-text mirror for search indexing
CONTENT_TEXT = """Attendance & Leave Policy
Document: GRT/ALP/POL/V-2 | Effective: 1st June 2026

Purpose: Outlines the attendance, leave, and work discipline framework for all on-roll employees of Ethara AI to ensure operational continuity, workforce planning, compliance, accountability, and transparent leave management.

Scope: All on-roll employees of Ethara AI.

Attendance Protocol:
- Biometric attendance system only
- Working Days: Monday to Friday
- Official working hours: 10:00 AM to 7:00 PM
- 9 working hours daily, 30 minutes grace period
- Late comers: 10:30 AM to 11:30 AM, max 3 instances per month
- After 4th late: warning / LOP. After 11:30 AM without intimation: Absent
- Saturdays/Sundays generally weekly offs

Public Holidays: National and Festival Holidays as declared. Holiday calendar communicated by HR yearly.

Leave Cycle: January to December every calendar year.

Leave Application Process:
- Submit via GreytHR only
- Email, Slack, WhatsApp, verbal not valid
- Operations teams: additionally CTO/COO consolidated approval
- EL: 3 days in advance. CL/SL: same day only for emergencies

Leave Types & Entitlements:
- Earned Leave (EL): 18 days/year, monthly accrual, full day only, max 30 carry forward, encashable on separation
- Casual Leave (CL): 7 days/year, half-yearly credit, half/full day, max 3 consecutive, lapses yearly, not for probation
- Sick Leave (SL): 7 days/year, annual credit, medical doc for >3 consecutive, lapses yearly

Special Leaves:
- Maternity: 26 weeks (first 2 children), 12 weeks (3+ children), 8 weeks pre-delivery option, 6 weeks miscarriage, 12 weeks adoption (<3 months old)
- Paternity: 5 working days, within 30 days of childbirth
- Bereavement: 3 working days for immediate family
- Marriage: 5 working days, once during tenure

Leave Combinations: CL+SL Not Allowed. EL+CL Allowed. EL+SL Allowed.

Additional Workplace Flexibility (subject to approval):
- Work From Home: max 2 days/month
- Menstruation Leave: 1 per month for female employees

Compliance: Unauthorized absence = LOP. Disciplinary action for repeated violations.

Governance: Governed by applicable labour laws and Haryana Shops & Commercial Establishments provisions.

For clarification, contact HR Team.
"""


def main():
    _client, db, backend_name = create_database(Path(__file__).resolve().parents[1])
    print(f"Using backend store: {backend_name}")
    now = datetime.utcnow().isoformat()
    result = db.wiki_pages.update_one(
        {"slug": "leave-policy"},
        {
            "$set": {
                "title": "Attendance & Leave Policy",
                "subcategory": "Attendance & Leave Policy",
                "content_html": CONTENT_HTML,
                "content_text": CONTENT_TEXT,
                "updated_at": now,
                "updated_by": "system:policy-import",
                "version": "GRT/ALP/POL/V-2",
                "effective_date": "2026-06-01",
            }
        },
    )
    print(f"Matched: {result.matched_count} | Modified: {result.modified_count}")
    print(f"Title set to: Attendance & Leave Policy")
    print(f"Effective: 1st June 2026")
    print(f"HTML length: {len(CONTENT_HTML)} chars")


if __name__ == "__main__":
    main()
