const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'ame.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
    seedData();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unique_id TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      cover_color TEXT DEFAULT '#6C63FF',
      icon TEXT DEFAULT 'GE',
      total_pages INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      product_id INTEGER REFERENCES products(id),
      payment_method TEXT,
      payment_reference TEXT,
      amount REAL,
      status TEXT DEFAULT 'pending',
      verified_by INTEGER REFERENCES users(id),
      verified_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS device_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      device_fingerprint TEXT,
      device_info TEXT,
      session_id TEXT,
      last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS content_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER REFERENCES products(id),
      page_number INTEGER,
      title TEXT,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      discount_percent REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      max_uses INTEGER DEFAULT -1,
      used_count INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS security_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      username TEXT,
      event_type TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Add plain_password column if missing (migration for existing dbs)
  try { db.exec(`ALTER TABLE users ADD COLUMN plain_password TEXT`); } catch (e) {}
}

function seedData() {
  const hash = bcrypt.hashSync('Reviewers&Tutorials2026!', 10);
  const admin = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (admin) {
    db.prepare(`
      UPDATE users SET unique_id = ?, password_hash = ?, full_name = ? WHERE id = ?
    `).run('RTadmin101', hash, 'Admin RT', admin.id);
    console.log('✓ Admin credentials updated to RTadmin101');
  } else {
    db.prepare(`
      INSERT INTO users (unique_id, email, full_name, password_hash, role)
      VALUES (?, ?, ?, ?, ?)
    `).run('RTadmin101', 'admin@teachsmart.com', 'Admin RT', hash, 'admin');
    console.log('✓ Admin credentials created (RTadmin101)');
  }

  const productsExist = db.prepare('SELECT COUNT(*) as count FROM products').get();
  if (productsExist.count === 0) {
    const insertProduct = db.prepare(`
      INSERT INTO products (name, category, description, price, cover_color, icon)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertProduct.run(
      'General Education',
      'LET Reviewer',
      'Comprehensive reviewer covering all General Education topics for the Licensure Examination for Teachers.',
      149.00,
      '#6C63FF',
      'GE'
    );

    insertProduct.run(
      'Professional Education',
      'LET Reviewer',
      'Complete Professional Education reviewer with practice questions and key concepts for LET.',
      149.00,
      '#00D9A5',
      'PE'
    );

    insertProduct.run(
      'English Tutorial',
      'English Tutorial',
      'In-depth English language tutorial covering grammar, comprehension, and communication skills.',
      149.00,
      '#FF6B8A',
      'ET'
    );

    console.log('✓ Products seeded');

    // Seed some sample content pages for demo
    const insertPage = db.prepare(`
      INSERT INTO content_pages (product_id, page_number, title, content)
      VALUES (?, ?, ?, ?)
    `);

    // Sample pages for General Education
    const genEdPages = [
      { title: 'Chapter 1: Philippine Constitution', content: 'The 1987 Philippine Constitution is the supreme law of the Philippines. It was enacted in 1987 during the administration of President Corazon Aquino.\n\nKey Provisions:\n• Article I - National Territory\n• Article II - Declaration of Principles and State Policies\n• Article III - Bill of Rights\n• Article IV - Citizenship\n• Article V - Suffrage\n\nThe Constitution establishes the Philippines as a democratic and republican state where sovereignty resides in the people and all government authority emanates from them.' },
      { title: 'Chapter 2: Philippine History', content: 'Pre-Colonial Philippines (Before 1521)\nThe Philippines had a rich pre-colonial history with established trade relations with China, India, Japan, and other Southeast Asian neighbors.\n\nBarangay System:\n• The basic political unit was the barangay, led by a datu\n• Each barangay had 30-100 families\n• Social classes: Maharlika (nobility), Timawa (freemen), Alipin (dependents)\n\nSpanish Colonial Period (1521-1898)\nFerdinand Magellan arrived in 1521, marking the beginning of Spanish colonization that lasted over 300 years.' },
      { title: 'Chapter 3: General Science', content: 'Basic Scientific Concepts\n\nThe Scientific Method:\n1. Observation - Identifying a problem or question\n2. Hypothesis - Forming a testable explanation\n3. Experimentation - Testing the hypothesis\n4. Analysis - Examining the results\n5. Conclusion - Drawing conclusions based on evidence\n\nBranches of Science:\n• Biology - Study of living organisms\n• Chemistry - Study of matter and its interactions\n• Physics - Study of energy and forces\n• Earth Science - Study of Earth and its processes' },
      { title: 'Chapter 4: Mathematics', content: 'Fundamental Mathematical Concepts\n\nNumber Systems:\n• Natural Numbers (ℕ): 1, 2, 3, 4, ...\n• Whole Numbers (W): 0, 1, 2, 3, ...\n• Integers (ℤ): ..., -2, -1, 0, 1, 2, ...\n• Rational Numbers (ℚ): Numbers that can be expressed as fractions\n• Irrational Numbers: Numbers that cannot be expressed as fractions (π, √2)\n\nBasic Operations:\nAddition, Subtraction, Multiplication, Division\n\nOrder of Operations (PEMDAS):\nParentheses → Exponents → Multiplication/Division → Addition/Subtraction' },
      { title: 'Chapter 5: English Language', content: 'Parts of Speech\n\n1. Noun - A word that names a person, place, thing, or idea\n   Example: teacher, school, book, knowledge\n\n2. Pronoun - A word used in place of a noun\n   Example: he, she, it, they, we\n\n3. Verb - A word that expresses action or state of being\n   Example: teach, run, is, become\n\n4. Adjective - A word that describes a noun\n   Example: beautiful, large, intelligent\n\n5. Adverb - A word that modifies a verb, adjective, or another adverb\n   Example: quickly, very, extremely' },
    ];

    genEdPages.forEach((page, i) => {
      insertPage.run(1, i + 1, page.title, page.content);
    });

    // Sample pages for Professional Education
    const profEdPages = [
      { title: 'Chapter 1: Foundations of Education', content: 'Philosophy of Education\n\nMajor Philosophies:\n\n1. Idealism - Focus on ideas and intellectual development\n   Key Thinker: Plato\n   In Education: Emphasis on the study of great works and ideas\n\n2. Realism - Focus on the physical world and scientific observation\n   Key Thinker: Aristotle\n   In Education: Emphasis on scientific inquiry and hands-on learning\n\n3. Pragmatism - Focus on practical application and problem-solving\n   Key Thinker: John Dewey\n   In Education: Learning by doing, project-based learning\n\n4. Existentialism - Focus on individual choice and responsibility\n   Key Thinker: Jean-Paul Sartre\n   In Education: Student-centered learning, individual expression' },
      { title: 'Chapter 2: Child & Adolescent Development', content: 'Theories of Development\n\nPiaget\'s Cognitive Development Stages:\n1. Sensorimotor Stage (0-2 years) - Learning through senses and actions\n2. Preoperational Stage (2-7 years) - Symbolic thinking, egocentrism\n3. Concrete Operational (7-11 years) - Logical thinking about concrete events\n4. Formal Operational (11+ years) - Abstract and hypothetical thinking\n\nErikson\'s Psychosocial Development:\n• Trust vs. Mistrust (Infancy)\n• Autonomy vs. Shame (Early Childhood)\n• Initiative vs. Guilt (Preschool)\n• Industry vs. Inferiority (School Age)\n• Identity vs. Role Confusion (Adolescence)' },
      { title: 'Chapter 3: Principles of Teaching', content: 'Effective Teaching Strategies\n\n1. Direct Instruction\n   - Teacher-centered approach\n   - Structured and systematic\n   - Best for teaching specific skills and concepts\n\n2. Cooperative Learning\n   - Student-centered approach\n   - Group work and collaboration\n   - Develops social skills and teamwork\n\n3. Inquiry-Based Learning\n   - Student-driven exploration\n   - Develops critical thinking\n   - Encourages questioning and investigation\n\n4. Differentiated Instruction\n   - Adapting teaching to diverse learners\n   - Multiple modalities (visual, auditory, kinesthetic)\n   - Flexible grouping and assessment' },
      { title: 'Chapter 4: Assessment of Learning', content: 'Types of Assessment\n\n1. Formative Assessment\n   - Ongoing assessment during learning\n   - Purpose: Monitor student progress\n   - Examples: Quizzes, observations, exit tickets\n\n2. Summative Assessment\n   - Assessment at the end of a learning period\n   - Purpose: Evaluate student achievement\n   - Examples: Final exams, projects, portfolios\n\n3. Diagnostic Assessment\n   - Assessment before instruction\n   - Purpose: Identify strengths and weaknesses\n   - Examples: Pre-tests, KWL charts\n\nBloom\'s Taxonomy (Revised):\nRemember → Understand → Apply → Analyze → Evaluate → Create' },
    ];

    profEdPages.forEach((page, i) => {
      insertPage.run(2, i + 1, page.title, page.content);
    });

    // Sample pages for English Tutorial
    const engPages = [
      { title: 'Chapter 1: Grammar Fundamentals', content: 'Subject-Verb Agreement\n\nRule 1: A singular subject takes a singular verb.\n   Example: The student studies hard.\n\nRule 2: A plural subject takes a plural verb.\n   Example: The students study hard.\n\nRule 3: Compound subjects joined by "and" take a plural verb.\n   Example: Rice and fish are staple foods.\n\nRule 4: When subjects are joined by "or" or "nor," the verb agrees with the nearest subject.\n   Example: Neither the teacher nor the students were late.\n\nRule 5: Collective nouns can be singular or plural depending on context.\n   Example: The team is winning. (acting as one unit)\n   Example: The team are arguing among themselves. (acting individually)' },
      { title: 'Chapter 2: Reading Comprehension', content: 'Strategies for Effective Reading\n\n1. Previewing\n   - Scan headings, subheadings, and bold words\n   - Look at images and captions\n   - Read the introduction and conclusion first\n\n2. Active Reading\n   - Highlight key ideas\n   - Write margin notes\n   - Ask questions while reading\n\n3. Identifying Main Ideas\n   - Look for topic sentences (usually first or last sentence)\n   - Distinguish between main ideas and supporting details\n   - Summarize paragraphs in your own words\n\n4. Making Inferences\n   - Read between the lines\n   - Use context clues\n   - Connect prior knowledge with text information' },
      { title: 'Chapter 3: Writing Skills', content: 'Essay Writing Structure\n\n1. Introduction\n   - Hook: Grab the reader\'s attention\n   - Background: Provide context\n   - Thesis Statement: State your main argument\n\n2. Body Paragraphs\n   - Topic Sentence: Main idea of the paragraph\n   - Supporting Details: Evidence and examples\n   - Analysis: Explain how evidence supports the topic\n   - Transition: Connect to the next paragraph\n\n3. Conclusion\n   - Restate Thesis: Rephrase your main argument\n   - Summarize Key Points: Brief overview of main ideas\n   - Closing Statement: Final thought or call to action\n\nTypes of Essays:\n• Narrative, Descriptive, Expository, Persuasive, Argumentative' },
    ];

    engPages.forEach((page, i) => {
      insertPage.run(3, i + 1, page.title, page.content);
    });

    // Update page counts
    db.prepare('UPDATE products SET total_pages = 5 WHERE id = 1').run();
    db.prepare('UPDATE products SET total_pages = 4 WHERE id = 2').run();
    db.prepare('UPDATE products SET total_pages = 3 WHERE id = 3').run();

    console.log('✓ Sample content pages seeded');
  }
}

module.exports = { getDb };
