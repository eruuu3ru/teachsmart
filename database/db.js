const { initializeApp, getApps, cert, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const bcrypt = require('bcryptjs');

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey) {
  privateKey = privateKey.replace(/\\n/g, '\n');
}

if (getApps().length === 0) {
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && privateKey) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.appspot.com`
    });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({
      credential: applicationDefault(),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET
    });
  } else {
    // Look for local serviceAccountKey.json
    const fs = require('fs');
    const path = require('path');
    const localKeyPath = path.join(__dirname, '..', 'serviceAccountKey.json');
    if (fs.existsSync(localKeyPath)) {
      const serviceAccount = require(localKeyPath);
      initializeApp({
        credential: cert(serviceAccount),
        storageBucket: serviceAccount.project_id + '.appspot.com'
      });
    } else {
      console.warn("=========================================================================");
      console.warn("WARNING: Firebase credentials not found!");
      console.warn("To run this application, please either:");
      console.warn("1. Place your serviceAccountKey.json file in the project root directory.");
      console.warn("2. Or add the following environment variables to your .env file:");
      console.warn("   FIREBASE_PROJECT_ID=your-project-id");
      console.warn("   FIREBASE_CLIENT_EMAIL=your-client-email");
      console.warn("   FIREBASE_PRIVATE_KEY=\"your-private-key\"");
      console.warn("=========================================================================");
      // Fallback to emulator mode so it doesn't crash on boot (requires emulator running)
      process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
      initializeApp({
        projectId: "demo-reviewvault"
      });
    }
  }
}

const firestore = getFirestore();
const storage = getStorage();

function formatDoc(doc) {
  if (!doc.exists) return null;
  const data = doc.data();
  // Format timestamps
  for (const key in data) {
    if (data[key] && typeof data[key].toDate === 'function') {
      data[key] = data[key].toDate().toISOString().replace('T', ' ').substring(0, 19);
    }
  }
  return { id: doc.id, ...data };
}

const db = {
  firestore,
  storage,

  users: {
    async get(id) {
      if (!id) return null;
      const doc = await firestore.collection('users').doc(String(id)).get();
      return formatDoc(doc);
    },
    async getByUniqueId(uniqueId) {
      const snapshot = await firestore.collection('users').where('unique_id', '==', uniqueId).limit(1).get();
      if (snapshot.empty) return null;
      return formatDoc(snapshot.docs[0]);
    },
    async getByEmail(email) {
      const snapshot = await firestore.collection('users').where('email', '==', email).limit(1).get();
      if (snapshot.empty) return null;
      return formatDoc(snapshot.docs[0]);
    },
    async insert(user) {
      const ref = firestore.collection('users').doc();
      const userData = {
        unique_id: user.unique_id,
        email: user.email,
        full_name: user.full_name,
        phone: user.phone || null,
        password_hash: user.password_hash,
        role: user.role || 'user',
        is_active: user.is_active !== undefined ? user.is_active : 1,
        plain_password: user.plain_password || null,
        created_at: FieldValue.serverTimestamp()
      };
      await ref.set(userData);
      return { id: ref.id, ...userData };
    },
    async update(id, data) {
      const updated = { ...data };
      await firestore.collection('users').doc(String(id)).update(updated);
    },
    async delete(id) {
      await firestore.collection('users').doc(String(id)).delete();
    },
    async list() {
      const snapshot = await firestore.collection('users').orderBy('created_at', 'desc').get();
      return snapshot.docs.map(formatDoc);
    }
  },

  products: {
    async get(id) {
      if (!id) return null;
      const doc = await firestore.collection('products').doc(String(id)).get();
      return formatDoc(doc);
    },
    async listActive() {
      const snapshot = await firestore.collection('products').where('is_active', '==', 1).get();
      return snapshot.docs.map(formatDoc);
    },
    async listAll() {
      const snapshot = await firestore.collection('products').get();
      return snapshot.docs.map(formatDoc);
    },
    async update(id, data) {
      await firestore.collection('products').doc(String(id)).update(data);
    }
  },

  orders: {
    async get(id) {
      if (!id) return null;
      const doc = await firestore.collection('orders').doc(String(id)).get();
      return formatDoc(doc);
    },
    async listByUserId(userId) {
      const snapshot = await firestore.collection('orders').where('user_id', '==', String(userId)).get();
      return snapshot.docs.map(formatDoc);
    },
    async listAll() {
      const snapshot = await firestore.collection('orders').orderBy('created_at', 'desc').get();
      return snapshot.docs.map(formatDoc);
    },
    async insert(order) {
      const ref = firestore.collection('orders').doc();
      const orderData = {
        user_id: String(order.user_id),
        product_id: Number(order.product_id),
        payment_method: order.payment_method,
        payment_reference: order.payment_reference,
        amount: Number(order.amount),
        status: order.status || 'pending',
        verified_by: order.verified_by || null,
        verified_at: order.verified_at || null,
        created_at: FieldValue.serverTimestamp()
      };
      await ref.set(orderData);
      return { id: ref.id, ...orderData };
    },
    async update(id, data) {
      const updated = { ...data };
      if (updated.verified_at === 'CURRENT_TIMESTAMP' || updated.verified_at === FieldValue.serverTimestamp()) {
        updated.verified_at = FieldValue.serverTimestamp();
      }
      await firestore.collection('orders').doc(String(id)).update(updated);
    },
    async deleteByPaymentReference(paymentRef) {
      const snapshot = await firestore.collection('orders')
        .where('payment_reference', '>=', paymentRef)
        .where('payment_reference', '<=', paymentRef + '\uf8ff')
        .get();
      const batch = firestore.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
    },
    async listByPaymentReference(paymentRef) {
      const snapshot = await firestore.collection('orders')
        .where('payment_reference', '>=', paymentRef)
        .where('payment_reference', '<=', paymentRef + '\uf8ff')
        .get();
      return snapshot.docs.map(formatDoc);
    }
  },

  device_sessions: {
    async getByUserAndFingerprint(userId, fingerprint) {
      const snapshot = await firestore.collection('device_sessions')
        .where('user_id', '==', String(userId))
        .where('device_fingerprint', '==', fingerprint)
        .where('is_active', '==', 1)
        .limit(1)
        .get();
      if (snapshot.empty) return null;
      return formatDoc(snapshot.docs[0]);
    },
    async countActive(userId) {
      const snapshot = await firestore.collection('device_sessions')
        .where('user_id', '==', String(userId))
        .where('is_active', '==', 1)
        .get();
      return snapshot.size;
    },
    async insert(session) {
      const ref = firestore.collection('device_sessions').doc();
      const sessionData = {
        user_id: String(session.user_id),
        device_fingerprint: session.device_fingerprint,
        device_info: session.device_info,
        session_id: session.session_id,
        last_active: FieldValue.serverTimestamp(),
        is_active: session.is_active !== undefined ? session.is_active : 1
      };
      await ref.set(sessionData);
      return { id: ref.id, ...sessionData };
    },
    async update(id, data) {
      const updated = { ...data };
      if (updated.last_active === 'CURRENT_TIMESTAMP') {
        updated.last_active = FieldValue.serverTimestamp();
      }
      await firestore.collection('device_sessions').doc(String(id)).update(updated);
    },
    async deactivateAllForUser(userId) {
      const snapshot = await firestore.collection('device_sessions')
        .where('user_id', '==', String(userId))
        .where('is_active', '==', 1)
        .get();
      const batch = firestore.batch();
      snapshot.docs.forEach(doc => {
        batch.update(doc.ref, { is_active: 0 });
      });
      await batch.commit();
    },
    async deactivateUserDevice(userId, fingerprint) {
      const snapshot = await firestore.collection('device_sessions')
        .where('user_id', '==', String(userId))
        .where('device_fingerprint', '==', fingerprint)
        .where('is_active', '==', 1)
        .get();
      const batch = firestore.batch();
      snapshot.docs.forEach(doc => {
        batch.update(doc.ref, { is_active: 0 });
      });
      await batch.commit();
    }
  },

  content_pages: {
    async listByProductId(productId) {
      const snapshot = await firestore.collection('content_pages')
        .where('product_id', '==', Number(productId))
        .orderBy('page_number')
        .get();
      return snapshot.docs.map(formatDoc);
    },
    async getByPageNumber(productId, pageNumber) {
      const snapshot = await firestore.collection('content_pages')
        .where('product_id', '==', Number(productId))
        .where('page_number', '==', Number(pageNumber))
        .limit(1)
        .get();
      if (snapshot.empty) return null;
      return formatDoc(snapshot.docs[0]);
    },
    async countByProductId(productId) {
      const snapshot = await firestore.collection('content_pages')
        .where('product_id', '==', Number(productId))
        .get();
      return snapshot.size;
    },
    async insert(page) {
      const ref = firestore.collection('content_pages').doc();
      const pageData = {
        product_id: Number(page.product_id),
        page_number: Number(page.page_number),
        title: page.title,
        content: page.content,
        created_at: FieldValue.serverTimestamp()
      };
      await ref.set(pageData);
      return { id: ref.id, ...pageData };
    },
    async delete(id) {
      await firestore.collection('content_pages').doc(String(id)).delete();
    },
    async get(id) {
      if (!id) return null;
      const doc = await firestore.collection('content_pages').doc(String(id)).get();
      return formatDoc(doc);
    }
  },

  coupons: {
    async getByCode(code) {
      if (!code) return null;
      const snapshot = await firestore.collection('coupons')
        .where('code', '==', code.toUpperCase())
        .limit(1)
        .get();
      if (snapshot.empty) return null;
      return formatDoc(snapshot.docs[0]);
    },
    async incrementUsedCount(id) {
      await firestore.collection('coupons').doc(String(id)).update({
        used_count: FieldValue.increment(1)
      });
    },
    async listAll() {
      const snapshot = await firestore.collection('coupons').orderBy('created_at', 'desc').get();
      return snapshot.docs.map(formatDoc);
    },
    async insert(coupon) {
      const ref = firestore.collection('coupons').doc();
      const couponData = {
        code: coupon.code.toUpperCase(),
        discount_percent: Number(coupon.discount_percent) || 0,
        discount_amount: Number(coupon.discount_amount) || 0,
        max_uses: Number(coupon.max_uses) || -1,
        used_count: 0,
        is_active: coupon.is_active !== undefined ? coupon.is_active : 1,
        expires_at: coupon.expires_at || null,
        created_at: FieldValue.serverTimestamp()
      };
      await ref.set(couponData);
      return { id: ref.id, ...couponData };
    }
  },

  security_alerts: {
    async insert(alert) {
      const ref = firestore.collection('security_alerts').doc();
      const alertData = {
        user_id: alert.user_id ? String(alert.user_id) : null,
        username: alert.username,
        event_type: alert.event_type,
        details: alert.details || '',
        created_at: FieldValue.serverTimestamp()
      };
      await ref.set(alertData);
      return { id: ref.id, ...alertData };
    },
    async listLatest(limitCount = 100) {
      const snapshot = await firestore.collection('security_alerts')
        .orderBy('created_at', 'desc')
        .limit(limitCount)
        .get();
      return snapshot.docs.map(formatDoc);
    },
    async clearAll() {
      const snapshot = await firestore.collection('security_alerts').get();
      const batch = firestore.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
    },
    async delete(id) {
      await firestore.collection('security_alerts').doc(String(id)).delete();
    }
  }
};

// Seed database if empty
async function initDb() {
  // Check products
  const productsSnapshot = await firestore.collection('products').limit(1).get();
  if (productsSnapshot.empty) {
    console.log('Seeding products and content pages to Firestore...');
    const productsData = [
      {
        id: '1',
        name: 'General Education',
        category: 'LET Reviewer',
        description: 'Comprehensive reviewer covering all General Education topics for the Licensure Examination for Teachers.',
        price: 149.00,
        cover_color: '#6C63FF',
        icon: 'GE',
        total_pages: 5,
        is_active: 1
      },
      {
        id: '2',
        name: 'Professional Education',
        category: 'LET Reviewer',
        description: 'Complete Professional Education reviewer with practice questions and key concepts for LET.',
        price: 149.00,
        cover_color: '#00D9A5',
        icon: 'PE',
        total_pages: 4,
        is_active: 1
      },
      {
        id: '3',
        name: 'English Tutorial',
        category: 'English Tutorial',
        description: 'In-depth English language tutorial covering grammar, comprehension, and communication skills.',
        price: 149.00,
        cover_color: '#FF6B8A',
        icon: 'ET',
        total_pages: 3,
        is_active: 1
      }
    ];

    for (const p of productsData) {
      const docId = p.id;
      const data = { ...p };
      delete data.id;
      await firestore.collection('products').doc(docId).set({
        ...data,
        created_at: FieldValue.serverTimestamp()
      });
    }

    // Seed content pages
    const genEdPages = [
      { title: 'Chapter 1: Philippine Constitution', content: 'The 1987 Philippine Constitution is the supreme law of the Philippines. It was enacted in 1987 during the administration of President Corazon Aquino.\n\nKey Provisions:\n• Article I - National Territory\n• Article II - Declaration of Principles and State Policies\n• Article III - Bill of Rights\n• Article IV - Citizenship\n• Article V - Suffrage\n\nThe Constitution establishes the Philippines as a democratic and republican state where sovereignty resides in the people and all government authority emanates from them.' },
      { title: 'Chapter 2: Philippine History', content: 'Pre-Colonial Philippines (Before 1521)\nThe Philippines had a rich pre-colonial history with established trade relations with China, India, Japan, and other Southeast Asian neighbors.\n\nBarangay System:\n• The basic political unit was the barangay, led by a datu\n• Each barangay had 30-100 families\n• Social classes: Maharlika (nobility), Timawa (freemen), Alipin (dependents)\n\nSpanish Colonial Period (1521-1898)\nFerdinand Magellan arrived in 1521, marking the beginning of Spanish colonization that lasted over 300 years.' },
      { title: 'Chapter 3: General Science', content: 'Basic Scientific Concepts\n\nThe Scientific Method:\n1. Observation - Identifying a problem or question\n2. Hypothesis - Forming a testable explanation\n3. Experimentation - Testing the hypothesis\n4. Analysis - Examining the results\n5. Conclusion - Drawing conclusions based on evidence\n\nBranches of Science:\n• Biology - Study of living organisms\n• Chemistry - Study of matter and its interactions\n• Physics - Study of energy and forces\n• Earth Science - Study of Earth and its processes' },
      { title: 'Chapter 4: Mathematics', content: 'Fundamental Mathematical Concepts\n\nNumber Systems:\n• Natural Numbers (ℕ): 1, 2, 3, 4, ...\n• Whole Numbers (W): 0, 1, 2, 3, ...\n• Integers (ℤ): ..., -2, -1, 0, 1, 2, ...\n• Rational Numbers (ℚ): Numbers that can be expressed as fractions\n• Irrational Numbers: Numbers that cannot be expressed as fractions (π, √2)\n\nBasic Operations:\nAddition, Subtraction, Multiplication, Division\n\nOrder of Operations (PEMDAS):\nParentheses → Exponents → Multiplication/Division → Addition/Subtraction' },
      { title: 'Chapter 5: English Language', content: 'Parts of Speech\n\n1. Noun - A word that names a person, place, thing, or idea\n   Example: teacher, school, book, knowledge\n\n2. Pronoun - A word used in place of a noun\n   Example: he, she, it, they, we\n\n3. Verb - A word that expresses action or state of being\n   Example: teach, run, is, become\n\n4. Adjective - A word that describes a noun\n   Example: beautiful, large, intelligent\n\n5. Adverb - A word that modifies a verb, adjective, or another adverb\n   Example: quickly, very, extremely' },
    ];

    const profEdPages = [
      { title: 'Chapter 1: Foundations of Education', content: 'Philosophy of Education\n\nMajor Philosophies:\n\n1. Idealism - Focus on ideas and intellectual development\n   Key Thinker: Plato\n   In Education: Emphasis on the study of great works and ideas\n\n2. Realism - Focus on the physical world and scientific observation\n   Key Thinker: Aristotle\n   In Education: Emphasis on scientific inquiry and hands-on learning\n\n3. Pragmatism - Focus on practical application and problem-solving\n   Key Thinker: John Dewey\n   In Education: Learning by doing, project-based learning\n\n4. Existentialism - Focus on individual choice and responsibility\n   Key Thinker: Jean-Paul Sartre\n   In Education: Student-centered learning, individual expression' },
      { title: 'Chapter 2: Child & Adolescent Development', content: 'Theories of Development\n\nPiaget\'s Cognitive Development Stages:\n1. Sensorimotor Stage (0-2 years) - Learning through senses and actions\n2. Preoperational Stage (2-7 years) - Symbolic thinking, egocentrism\n3. Concrete Operational (7-11 years) - Logical thinking about concrete events\n4. Formal Operational (11+ years) - Abstract and hypothetical thinking\n\nErikson\'s Psychosocial Development:\n• Trust vs. Mistrust (Infancy)\n• Autonomy vs. Shame (Early Childhood)\n• Initiative vs. Guilt (Preschool)\n• Industry vs. Inferiority (School Age)\n• Identity vs. Role Confusion (Adolescence)' },
      { title: 'Chapter 3: Principles of Teaching', content: 'Effective Teaching Strategies\n\n1. Direct Instruction\n   - Teacher-centered approach\n   - Structured and systematic\n   - Best for teaching specific skills and concepts\n\n2. Cooperative Learning\n   - Student-centered approach\n   - Group work and collaboration\n   - Develops social skills and teamwork\n\n3. Inquiry-Based Learning\n   - Student-driven exploration\n   - Develops critical thinking\n   - Encourages questioning and investigation\n\n4. Differentiated Instruction\n   - Adapting teaching to diverse learners\n   - Multiple modalities (visual, auditory, kinesthetic)\n   - Flexible grouping and assessment' },
      { title: 'Chapter 4: Assessment of Learning', content: 'Types of Assessment\n\n1. Formative Assessment\n   - Ongoing assessment during learning\n   - Purpose: Monitor student progress\n   - Examples: Quizzes, observations, exit tickets\n\n2. Summative Assessment\n   - Assessment at the end of a learning period\n   - Purpose: Evaluate student achievement\n   - Examples: Final exams, projects, portfolios\n\n3. Diagnostic Assessment\n   - Assessment before instruction\n   - Purpose: Identify strengths and weaknesses\n   - Examples: Pre-tests, KWL charts\n\nBloom\'s Taxonomy (Revised):\nRemember → Understand → Apply → Analyze → Evaluate → Create' },
    ];

    const engPages = [
      { title: 'Chapter 1: Grammar Fundamentals', content: 'Subject-Verb Agreement\n\nRule 1: A singular subject takes a singular verb.\n   Example: The student studies hard.\n\nRule 2: A plural subject takes a plural verb.\n   Example: The students study hard.\n\nRule 3: Compound subjects joined by "and" take a plural verb.\n   Example: Rice and fish are staple foods.\n\nRule 4: When subjects are joined by "or" or "nor," the verb agrees with the nearest subject.\n   Example: Neither the teacher nor the students were late.\n\nRule 5: Collective nouns can be singular or plural depending on context.\n   Example: The team is winning. (acting as one unit)\n   Example: The team are arguing among themselves. (acting individually)' },
      { title: 'Chapter 2: Reading Comprehension', content: 'Strategies for Effective Reading\n\n1. Previewing\n   - Scan headings, subheadings, and bold words\n   - Look at images and captions\n   - Read the introduction and conclusion first\n\n2. Active Reading\n   - Highlight key ideas\n   - Write margin notes\n   - Ask questions while reading\n\n3. Identifying Main Ideas\n   - Look for topic sentences (usually first or last sentence)\n   - Distinguish between main ideas and supporting details\n   - Summarize paragraphs in your own words\n\n4. Making Inferences\n   - Read between the lines\n   - Use context clues\n   - Connect prior knowledge with text information' },
      { title: 'Chapter 3: Writing Skills', content: 'Essay Writing Structure\n\n1. Introduction\n   - Hook: Grab the reader\'s attention\n   - Background: Provide context\n   - Thesis Statement: State your main argument\n\n2. Body Paragraphs\n   - Topic Sentence: Main idea of the paragraph\n   - Supporting Details: Evidence and examples\n   - Analysis: Explain how evidence supports the topic\n   - Transition: Connect to the next paragraph\n\n3. Conclusion\n   - Restate Thesis: Rephrase your main argument\n   - Summarize Key Points: Brief overview of main ideas\n   - Closing Statement: Final thought or call to action\n\nTypes of Essays:\n• Narrative, Descriptive, Expository, Persuasive, Argumentative' },
    ];

    const addPages = async (prodId, pagesList) => {
      for (let i = 0; i < pagesList.length; i++) {
        await db.content_pages.insert({
          product_id: prodId,
          page_number: i + 1,
          title: pagesList[i].title,
          content: pagesList[i].content
        });
      }
    };

    await addPages(1, genEdPages);
    await addPages(2, profEdPages);
    await addPages(3, engPages);
    console.log('✓ Seeding complete.');
  }

  // Check admin user
  const adminSnapshot = await firestore.collection('users').where('role', '==', 'admin').limit(1).get();
  if (adminSnapshot.empty) {
    console.log('Seeding admin user to Firestore...');
    const hash = bcrypt.hashSync('Reviewers&Tutorials2026!', 10);
    await db.users.insert({
      unique_id: 'RTadmin101',
      email: 'admin@teachsmart.com',
      full_name: 'Admin RT',
      password_hash: hash,
      role: 'admin',
      is_active: 1
    });
    console.log('✓ Admin user RTadmin101 created.');
  }
}

module.exports = { db, initDb };
