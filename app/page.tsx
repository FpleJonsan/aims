const principles = [
  { number: '01', title: 'AI provides intelligence', text: 'Structured, evidence-backed analysis that remains optional.' },
  { number: '02', title: 'Policy provides control', text: 'Deterministic rules own authority, routing, and financial gates.' },
  { number: '03', title: 'Humans provide accountability', text: 'Every material decision has an authorized, auditable owner.' },
];

const workflow = [
  'Request Initiation',
  'Request Capture',
  'Validation',
  'Finance Context',
  'Financial Risk Analysis',
  'Policy & Decision',
  'Approval',
  'Final Finance Control',
  'Payment Processing',
  'Payment Record / History',
  'Finance Dashboard',
  'AI Finance Intelligence',
];

export default function Home() {
  return (
    <main>
      <nav className="nav" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="AIMS home"><span className="brandMark">A</span><span><b>AIMS</b><small>Finance control</small></span></a>
        <div className="navLinks"><a href="#principles">Principles</a><a href="#workflow">Workflow</a><a href="#architecture">Architecture</a></div>
        <a className="statusPill" href="#readiness"><i /> Day 0 complete</a>
      </nav>

      <section className="hero" id="top">
        <div className="eyebrow"><span>AImazing Intelligent Management System</span></div>
        <h1>Payment control,<br /><em>made intelligent.</em></h1>
        <p className="heroCopy">A production-oriented internal finance system for safer requests, stronger approvals, and evidence-backed intelligence.</p>
        <div className="heroActions"><a className="primaryButton" href="#architecture">Explore the architecture <span>↘</span></a><a className="textLink" href="#readiness">View Day 1 readiness <span>→</span></a></div>

        <div className="controlPanel" aria-label="AIMS control model">
          <div className="panelHeader"><span className="windowDots"><i /><i /><i /></span><span>CONTROL MODEL / LIVE BLUEPRINT</span><span className="secure">● SECURE BY DESIGN</span></div>
          <div className="panelBody">
            <div className="panelIntro"><span className="tinyLabel">CORE EQUATION</span><strong>Intelligence<br />without surrendering<br /><em>control.</em></strong></div>
            <div className="equation">
              <div><b>AI</b><small>understands<br />and explains</small></div><span>+</span>
              <div><b>POLICY</b><small>routes and<br />constrains</small></div><span>+</span>
              <div><b>HUMANS</b><small>decide and<br />account</small></div><span>=</span>
              <div className="outcome"><b>TRUST</b><small>auditable<br />finance</small></div>
            </div>
          </div>
        </div>
      </section>

      <section className="principles section" id="principles">
        <div className="sectionHeading"><span className="sectionNumber">01</span><div><p>OPERATING PRINCIPLES</p><h2>Clear boundaries.<br /><em>Safer outcomes.</em></h2></div><p className="sectionLead">AIMS separates intelligence, control, and accountability so each can do its job—and no component can quietly overreach.</p></div>
        <div className="principleGrid">
          {principles.map((item) => <article key={item.number}><span>{item.number}</span><div className="principleIcon" aria-hidden="true">{item.number === '01' ? '✦' : item.number === '02' ? '⌁' : '◎'}</div><h3>{item.title}</h3><p>{item.text}</p></article>)}
        </div>
      </section>

      <section className="workflow section" id="workflow">
        <div className="sectionHeading light"><span className="sectionNumber">02</span><div><p>LOCKED BUSINESS WORKFLOW</p><h2>One controlled path,<br /><em>end to end.</em></h2></div><p className="sectionLead">AI can assist eligible stages. It can never invent a state, select an approver, alter a balance, or mark a payment as paid.</p></div>
        <div className="workflowRail">{workflow.map((step, index) => <div className="workflowStep" key={step}><span>{String(index + 1).padStart(2, '0')}</span><b>{step}</b>{index < workflow.length - 1 && <i>→</i>}</div>)}</div>
        <div className="modeStrip"><div><span>✦</span><p><b>AI-assisted</b><small>Candidate analysis + human review</small></p></div><div><span>◇</span><p><b>Manual</b><small>First-class human processing</small></p></div><div><span>↻</span><p><b>Fallback</b><small>Provider failure never blocks work</small></p></div></div>
      </section>

      <section className="architecture section" id="architecture">
        <div className="sectionHeading"><span className="sectionNumber">03</span><div><p>PROPOSED ARCHITECTURE</p><h2>Built for integrity,<br /><em>not complexity.</em></h2></div><p className="sectionLead">A modular monolith keeps critical transactions together while independent web, API, and worker processes provide clean operational boundaries.</p></div>
        <div className="archLayout">
          <div className="archStack"><div className="archNode accent"><span>EXPERIENCE</span><b>Nuxt web + Telegram</b><small>Channels request actions. They never own authority.</small></div><div className="connector">↓ REST / VERIFIED COMMANDS</div><div className="archNode dark"><span>CONTROL PLANE</span><b>NestJS application</b><small>Identity · workflow · policy · approval · finance control</small></div><div className="archFork"><span>↙</span><span>↓</span><span>↘</span></div><div className="archData"><div><b>PostgreSQL</b><small>source of truth</small></div><div><b>Redis / BullMQ</b><small>durable work delivery</small></div><div><b>S3 / MinIO</b><small>immutable documents</small></div></div></div>
          <aside className="safeguards"><p className="tinyLabel">NON-NEGOTIABLE SAFEGUARDS</p><div><span>Financial truth</span><b>PostgreSQL + deterministic calculations</b></div><div><span>AI posture</span><b>Optional, bounded, evidence-required</b></div><div><span>Architecture</span><b>Modular monolith with isolated workers</b></div><div><span>Integrity</span><b>Transactions, locks, idempotency, audit</b></div></aside>
        </div>
      </section>

      <section className="readiness" id="readiness"><div><p>DAY 0 / FINAL READINESS</p><h2>Architecture complete.<br /><em>Ready for foundation work.</em></h2></div><div className="readinessCard"><span className="readyDot" /><div><small>DAY 0 STATUS</small><b>READY FOR DAY 1</b><p>Discovery, risk analysis, state model, security strategy, and execution plan are documented.</p></div></div></section>

      <footer><a className="brand footerBrand" href="#top"><span className="brandMark">A</span><span><b>AIMS</b><small>AI-Powered Payment & Finance Control</small></span></a><p>AI provides intelligence. Policy provides control.<br />Humans provide accountability.</p><span>Architecture blueprint · 2026</span></footer>
    </main>
  );
}
