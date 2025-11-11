require("dotenv").config();
const express = require("express");
const app = express();
const jwt = require("jsonwebtoken");
const cors = require("cors");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const port = process.env.PORT || 4000;

// Initialize Firebase Admin SDK
let isFirebaseInitialized = false;
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  
  if (serviceAccount.project_id) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    isFirebaseInitialized = true;
    console.log("✅ Firebase Admin initialized successfully");
  } else {
    console.log("⚠️ Firebase Admin not initialized - service account not found");
    console.log("💡 Tip: Add FIREBASE_SERVICE_ACCOUNT to .env file");
  }
} catch (error) {
  console.error("❌ Error initializing Firebase Admin:", error.message);
}

// middleware
const allowedOrigins = [
  'http://localhost:5173',
  'https://searchtutorbd.com'
  // আপনি এখানে আপনার অন্যান্য ফ্রন্টএন্ড URL যোগ করতে পারেন
];

app.use(cors({
  origin: function (origin, callback) {
    // মোবাইল অ্যাপ বা cURL রিকুয়েস্টের মতো অরিজিন ছাড়া রিকুয়েস্ট Allow করুন
    if (!origin) return callback(null, true);
    // if (allowedOrigins.indexOf(origin) === -1) {
    //   const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
    //   return callback(new Error(msg), false);
    // }
    return callback(null, true);
  },
  credentials: true
}));
app.use(express.json());

// OneSignal Configuration
const ONESIGNAL_APP_ID = 'a602ac0e-1f7d-4f4b-84dd-6990afc9cd7c';
const ONESIGNAL_REST_API_KEY = 'os_v2_app_uybkydq7pvhuxbg5ngik7sonpshd7dbnl5seun4palwkbwy624eu7ak6v5amv7btf3fhdqtpdwr5f7d2wyz57pohykliwitdu4u3lii';

// Function to send OneSignal notification
async function sendOneSignalNotification(filters, heading, content, data = {}) {
  try {
    const notificationPayload = {
      app_id: ONESIGNAL_APP_ID,
      filters: filters,
      headings: { en: heading },
      contents: { en: content },
      data: data,
      web_url: data.url || 'https://searchtutorbd.com',
      chrome_web_icon: 'https://searchtutorbd.com/images/WhatsApp Image 2025-09-09 at 10.14.08 PM.jpeg',
      firefox_icon: 'https://searchtutorbd.com/images/WhatsApp Image 2025-09-09 at 10.14.08 PM.jpeg',
      chrome_web_badge: 'https://searchtutorbd.com/images/WhatsApp Image 2025-09-09 at 10.14.08 PM.jpeg',
    };

    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
      },
      body: JSON.stringify(notificationPayload)
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log(`✅ OneSignal notification sent successfully`);
      console.log(`   Recipients: ${result.recipients || 0}`);
      return { success: true, data: result };
    } else {
      console.error(`❌ OneSignal notification failed:`, result);
      return { success: false, error: result };
    }
  } catch (error) {
    console.error('❌ Error sending OneSignal notification:', error);
    return { success: false, error: error.message };
  }
}

app.post("/jwt", (req, res) => {
  const user = req.body;

  if (!user || !user.uid || !user.email) {
    return res
      .status(400)
      .send({ success: false, error: "UID and email are required" });
  }

  const token = jwt.sign(user, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

  res.send({ success: true, token });
});


const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

//o current data base api
// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mjmwf3r.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`
const uri = process.env.URI

// Global collections - will be initialized in run()
let usersCollection;
let tuitionRequestsCollection;
let jobsCollection;
let applicationsCollection;
let hireRequestsCollection;
let notificationTokensCollection;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect(); // Explicitly connect to MongoDB

    const db = client.db("searchTeacherDb"); // Use your DB name
    usersCollection = db.collection("users");
    tuitionRequestsCollection = db.collection("tuitionRequests");
    jobsCollection = db.collection("jobs");
    applicationsCollection = db.collection("applications");
    hireRequestsCollection = db.collection("hireRequests");
    notificationTokensCollection = db.collection("notificationTokens"); // NEW: Persistent tokens

    // Create indexes for tokens collection
    await notificationTokensCollection.createIndexes([
      { key: { fcmToken: 1 }, unique: true },
      { key: { deviceId: 1 } },
      { key: { city: 1 } },
      { key: { userId: 1 } },
      { key: { lastActive: 1 } },
      { key: { isActive: 1 } }
    ]);
    console.log("✅ Notification tokens collection indexes created");

    // ===========================
    // 🔔 PUSH NOTIFICATION HELPER
    // ===========================
    async function sendPushNotifications(users, job) {
      try {
        // Check if Firebase Admin is initialized
        if (!isFirebaseInitialized) {
          console.log("⚠️ Push notifications disabled - Firebase Admin not initialized");
          console.log("💡 Add FIREBASE_SERVICE_ACCOUNT to .env to enable push notifications");
          return { success: 0, failed: 0, skipped: users.length };
        }

        if (!users || users.length === 0) {
          console.log("📭 No users to send notifications to");
          return { success: 0, failed: 0 };
        }

        // Filter users who have FCM tokens
        const usersWithTokens = users.filter(u => u.fcmToken);
        
        if (usersWithTokens.length === 0) {
          console.log("📭 No users with FCM tokens found");
          return { success: 0, failed: 0 };
        }

        const tokens = usersWithTokens.map(u => u.fcmToken);

        // Prepare message payload (optimized for all devices)
        const messagePayload = {
          notification: {
            title: `🎓 New Job in ${job.city}!`,
            body: `${job.title} - Salary: ${job.salary} BDT/month`,
          },
          data: {
            jobId: job.jobId.toString(),
            jobObjectId: job._id.toString(),
            city: job.city,
            salary: job.salary.toString(),
            click_action: `/job/${job._id}`,
          },
          // Android specific options
          android: {
            priority: 'high',
            notification: {
              sound: 'default',
              channelId: 'job-notifications',
              priority: 'high',
              defaultSound: true,
              defaultVibrateTimings: true,
            }
          },
          // Apple specific options  
          apns: {
            payload: {
              aps: {
                sound: 'default',
                badge: 1,
              }
            }
          },
          // Web push options
          webpush: {
            notification: {
              icon: '/logo.png',
              badge: '/logo.png',
              vibrate: [200, 100, 200],
              requireInteraction: false, // Auto-dismiss after timeout
              tag: 'job-notification',
              renotify: true,
            },
            fcmOptions: {
              link: `/job/${job._id}`
            }
          }
        };

        // Send notifications to each token with device-specific handling
        let successCount = 0;
        let failureCount = 0;
        const failedTokens = [];

        for (let i = 0; i < usersWithTokens.length; i++) {
          try {
            const user = usersWithTokens[i];
            const message = {
              ...messagePayload,
              token: user.fcmToken,
            };
            
            await admin.messaging().send(message);
            successCount++;
            console.log(`✅ Sent to ${user.deviceType || 'unknown'} device (${i + 1}/${usersWithTokens.length})`);
          } catch (error) {
            failureCount++;
            failedTokens.push(usersWithTokens[i].fcmToken);
            console.log(`❌ Failed to send to token ${i + 1}:`, error.code || error.message);
          }
        }
        
        console.log(`✅ Notifications sent: ${successCount} success, ${failureCount} failed`);
        
        // Remove invalid tokens from database
        if (failedTokens.length > 0) {
          await usersCollection.updateMany(
            { fcmToken: { $in: failedTokens } },
            { $unset: { fcmToken: "" } }
          );
          console.log(`🗑️ Removed ${failedTokens.length} invalid tokens`);
        }

        return { success: successCount, failed: failureCount };
      } catch (error) {
        console.error("❌ Error sending push notifications:", error);
        return { success: 0, failed: users.length, error: error.message };
      }
    }

    // GET route to fetch all users
    // app.get("/users", async (req, res) => {
    //   try {
    //     const allUsers = await usersCollection.find().toArray();
    //     res.send(allUsers);
    //   } catch (error) {
    //     console.error("Error fetching users:", error);
    //     res.status(500).send({ error: "Failed to fetch users" });
    //   }
    // });

    app.get("/users", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const role = req.query.role;
        const search = req.query.search;
        const city = req.query.city; // Add city parameter

        const filter = {};

        if (role && role !== "all") {
          filter.accountType = role;
        }

        if (city) {
          filter.city = city;
        }

        if (search) {
          filter.$or = [
            { name: { $regex: search, $options: "i" } },
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: "$_id" },
                  regex: search,
                  options: "i",
                },
              },
            },
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: "$tutorId" },
                  regex: search,
                  options: "i",
                },
              },
            },
          ];
        }

        // Total matching users for current filter
        const totalUsers = await usersCollection.countDocuments(filter);

        // Fetch paginated users using an aggregation pipeline
        const users = await usersCollection.aggregate([
          { $match: filter },
          {
            $addFields: {
              isVerified: { $ifNull: ["$isVerified", false] },
              isRedVerified: { $ifNull: ["$isRedVerified", false] },
            },
          },
          {
            $addFields: {
              sortPriority: {
                $cond: {
                  if: "$isVerified",
                  then: 1,
                  else: {
                    $cond: { if: "$isRedVerified", then: 3, else: 2 },
                  },
                },
              },
            },
          },
          { $sort: { sortPriority: 1, _id: -1 } }, // Primary sort by priority, secondary by newest
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ]).toArray();

        const totalPages = Math.ceil(totalUsers / limit);

        // Total counts for all roles (used for UI display)
        const [totalTutors, totalGuardians, totalAdmins, totalAllUsers] =
          await Promise.all([
            usersCollection.countDocuments({ accountType: "tutor" }),
            usersCollection.countDocuments({ accountType: "guardian" }),
            usersCollection.countDocuments({ accountType: "admin" }),
            usersCollection.estimatedDocumentCount(),
          ]);

        res.send({
          success: true,
          data: users,
          totalUsers,
          totalPages,
          currentPage: page,
          counts: {
            totalTutors,
            totalGuardians,
            totalAdmins,
            totalAllUsers,
          },
        });
      } catch (error) {
        console.error("Error fetching users:", error);
        res
          .status(500)
          .send({ success: false, error: "Failed to fetch users" });
      }
    });

    // Save a new user
    app.post("/users", async (req, res) => {
      try {
        const {
          uid,
          name,
          gender,
          phone,
          email,
          city,
          location,
          accountType,
          image,
        } = req.body;

        if (!uid || !email) {
          return res.status(400).send({ error: "UID and email are required" });
        }

        const existingUser = await usersCollection.findOne({ uid });
        if (existingUser) {
          // If user exists, send back their data with a 200 status
          return res.status(200).send(existingUser);
        }

        const newUser = {
          uid,
          name,
          gender,
          phone,
          email,
          city,
          location,
          accountType,
          image,
          profileViews: 0, // Initialize profile views
          class_1_5_details: "",
          class_6_8_details: "",
          class_10_12_details: "",
        };

        // Generate a custom tutorId for tutors
        if (accountType === 'tutor') {
            const lastTutor = await usersCollection.find({ tutorId: { $exists: true } }).sort({ tutorId: -1 }).limit(1).toArray();
            const newTutorId = lastTutor.length > 0 && lastTutor[0].tutorId ? lastTutor[0].tutorId + 1 : 10000;
            newUser.tutorId = newTutorId;
        }

        await usersCollection.insertOne(newUser);
        res.status(201).send(newUser);
      } catch (error) {
        console.error("Error saving user:", error);
        res.status(500).send({ error: "Failed to save user" });
      }
    });


    // ===========================
    // 🔔 ANONYMOUS TOKEN REGISTRATION
    // ===========================
    app.post("/notification-tokens/register", async (req, res) => {
      try {
        const { fcmToken, deviceId, city, deviceType, userAgent } = req.body;

        if (!fcmToken || !deviceId) {
          return res.status(400).send({ 
            success: false, 
            error: "FCM token and device ID are required" 
          });
        }

        // Check if token already exists
        const existingToken = await notificationTokensCollection.findOne({ fcmToken });

        if (existingToken) {
          // Update existing token
          await notificationTokensCollection.updateOne(
            { fcmToken },
            { 
              $set: { 
                city: city || existingToken.city,
                deviceType: deviceType || existingToken.deviceType,
                userAgent: userAgent || existingToken.userAgent,
                lastActive: new Date(),
                isActive: true
              } 
            }
          );

          console.log(`✅ Updated anonymous token for device: ${deviceId}`);
          return res.status(200).send({ 
            success: true, 
            message: "Token updated successfully",
            tokenId: existingToken._id
          });
        }

        // Create new anonymous token
        const newToken = {
          fcmToken,
          deviceId,
          userId: null, // Anonymous - no user linked yet
          city: city || null,
          deviceType: deviceType || 'unknown',
          userAgent: userAgent || null,
          isAnonymous: true,
          isActive: true,
          preferences: {
            cities: city ? [city] : [],
            categories: []
          },
          createdAt: new Date(),
          lastActive: new Date()
        };

        const result = await notificationTokensCollection.insertOne(newToken);

        console.log(`✅ Registered anonymous token for city: ${city || 'unspecified'}`);
        res.status(201).send({ 
          success: true, 
          message: "Anonymous token registered successfully",
          tokenId: result.insertedId
        });
      } catch (error) {
        console.error("❌ Error registering anonymous token:", error);
        res.status(500).send({ 
          success: false, 
          error: "Failed to register token" 
        });
      }
    });


    // ===========================
    // 🔔 SAVE FCM TOKEN (LOGIN)
    // ===========================
    app.post("/users/:uid/fcm-token", async (req, res) => {
      try {
        const { uid } = req.params;
        const { fcmToken, deviceType, userAgent, deviceId } = req.body;

        if (!uid || !fcmToken) {
          return res.status(400).send({ 
            success: false, 
            error: "UID and FCM token are required" 
          });
        }

        // Get user info for city
        const user = await usersCollection.findOne({ uid });
        if (!user) {
          return res.status(404).send({ 
            success: false, 
            error: "User not found" 
          });
        }

        // Update or create token in notificationTokens collection
        const existingToken = await notificationTokensCollection.findOne({ fcmToken });

        if (existingToken) {
          // Link existing anonymous token to user
          await notificationTokensCollection.updateOne(
            { fcmToken },
            { 
              $set: { 
                userId: uid,
                city: user.city || existingToken.city,
                deviceType: deviceType || existingToken.deviceType,
                userAgent: userAgent || existingToken.userAgent,
                isAnonymous: false,
                lastActive: new Date(),
                isActive: true
              } 
            }
          );
          console.log(`✅ Linked anonymous token to user: ${uid}`);
        } else {
          // Create new token entry
          await notificationTokensCollection.insertOne({
            fcmToken,
            deviceId: deviceId || null,
            userId: uid,
            city: user.city,
            deviceType: deviceType || 'unknown',
            userAgent: userAgent || null,
            isAnonymous: false,
            isActive: true,
            preferences: {
              cities: user.city ? [user.city] : [],
              categories: []
            },
            createdAt: new Date(),
            lastActive: new Date()
          });
          console.log(`✅ Created new token for user: ${uid}`);
        }

        // Also update user collection (backward compatibility)
        const updateData = {
          fcmToken, 
          lastTokenUpdate: new Date(),
          notificationEnabled: true
        };

        // Store device info for better targeting
        if (deviceType) {
          updateData.deviceType = deviceType;
        }
        if (userAgent) {
          updateData.lastUserAgent = userAgent;
        }

        const result = await usersCollection.updateOne(
          { uid },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ 
            success: false, 
            error: "User not found" 
          });
        }

        console.log(`✅ FCM token saved for user: ${uid} (${deviceType || 'unknown device'})`);

        res.status(200).send({ 
          success: true, 
          message: "FCM token saved successfully" 
        });
      } catch (error) {
        console.error("❌ Error saving FCM token:", error);
        res.status(500).send({ 
          success: false, 
          error: "Failed to save FCM token" 
        });
      }
    });

    // ===========================
    // OneSignal Subscription API
    // ===========================
    app.post("/users/:uid/onesignal-subscription", async (req, res) => {
      try {
        const { uid } = req.params;
        const { playerId, city, deviceType } = req.body;

        if (!uid || !playerId) {
          return res.status(400).send({ 
            success: false, 
            error: "UID and Player ID are required" 
          });
        }

        // Get user info
        const user = await usersCollection.findOne({ uid });
        if (!user) {
          return res.status(404).send({ 
            success: false, 
            error: "User not found" 
          });
        }

        // Save OneSignal subscription
        const subscriptionData = {
          playerId,
          userId: uid,
          email: user.email,
          city: city || user.city,
          deviceType: deviceType || 'unknown',
          isActive: true,
          createdAt: new Date(),
          lastActive: new Date(),
        };

        // Upsert subscription
        await notificationTokensCollection.updateOne(
          { userId: uid, playerId },
          { $set: subscriptionData },
          { upsert: true }
        );

        console.log(`✅ OneSignal subscription saved for user: ${uid}`);

        res.status(200).send({ 
          success: true, 
          message: "OneSignal subscription saved successfully",
          data: subscriptionData
        });
      } catch (error) {
        console.error("❌ Error saving OneSignal subscription:", error);
        res.status(500).send({ 
          success: false, 
          error: "Failed to save OneSignal subscription" 
        });
      }
    });


    // users skill update
    app.put("/users/:id/skills", async (req, res) => {
      const { id } = req.params;
      const { skills } = req.body;

      console.log("ID:", id);
      console.log("Skills:", skills);

      if (!Array.isArray(skills)) {
        return res.status(400).json({ error: "Skills must be an array" });
      }

      try {
        const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { uid: id };

        const result = await usersCollection.updateOne(
          query,
          { $set: { skills } },
          { upsert: false }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: "User not found" });
        }

        res.json({ message: "✅ Skills updated successfully", skills });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "❌ Failed to update skills" });
      }
    });

    // Save a update user
    app.patch("/users/:uid", verifyToken, async (req, res) => {
      try {
        const uid = req.params.uid;
        const updateData = req.body;

        // Only allow specific fields to update:
        const allowedFields = [
          "name",
          "phone",
          "whatsapp",
          "gender",
          "city",
          "location",
          "fbLink",
          "institute",
          // "idNo",
          "department",
          "degree",
          "passingYear",
          "experience",
          "agreement",
          "image",
          "nid",
          "idCard",
        ];

        // Filter updateData
        const filteredData = {};
        for (const key of allowedFields) {
          if (updateData[key] !== undefined) {
            filteredData[key] = updateData[key];
          }
        }

        const result = await usersCollection.updateOne(
          { uid },
          { $set: filteredData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ error: "User not found" });
        }

        // Return updated user info
        const updatedUser = await usersCollection.findOne({ uid });

        res.send(updatedUser);
      } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).send({ error: "Failed to update user" });
      }
    });

    app.patch("/users/:id/note", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { adminNote } = req.body;

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { adminNote } }
        );

        if (result.modifiedCount === 1) {
          res
            .status(200)
            .send({ success: true, message: "Admin note updated." });
        } else {
          res.status(404).send({ success: false, message: "User not found." });
        }
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .send({ success: false, message: "Internal server error." });
      }
    });

    // PATCH route to update user's tab details
    app.patch("/users/tab-details/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { class_1_5_details, class_6_8_details, class_10_12_details } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid user ID format." });
        }

        // Construct an update object with only the fields provided in the request
        const updateData = {};
        if (class_1_5_details !== undefined) {
          updateData.class_1_5_details = class_1_5_details;
        }
        if (class_6_8_details !== undefined) {
          updateData.class_6_8_details = class_6_8_details;
        }
        if (class_10_12_details !== undefined) {
          updateData.class_10_12_details = class_10_12_details;
        }

        // Check if there is anything to update
        if (Object.keys(updateData).length === 0) {
          return res.status(400).send({ success: false, message: "No details provided to update." });
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ success: false, message: "User not found." });
        }

        res.status(200).send({ success: true, message: "Tutor details updated successfully." });

      } catch (error) {
        console.error("Error updating tab details:", error);
        res.status(500).send({ success: false, message: "Internal server error." });
      }
    });

    // Get a user by uid
    app.get("/users/:uid", verifyToken, async (req, res) => {
      try {
        const uid = req.params.uid;
        const user = await usersCollection.findOne({ uid });

        if (!user) {
          return res.status(404).send({ error: "User not found" });
        }

        res.send(user);
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).send({ error: "Failed to fetch user" });
      }
    });

    // Get a user by _id
    app.get("/user-by-id/:id", async (req, res) => {
      try {
        const id = req.params.id;
        console.log('Fetching user by ID:', id); // Debugging log
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ error: "Invalid user ID format" });
        }
        const user = await usersCollection.findOne({ _id: new ObjectId(id) });

        if (!user) {
          return res.status(404).send({ error: "User not found" });
        }

        res.send(user);
      } catch (error) {
        console.error("Error fetching user by ID:", error);
        res.status(500).send({ error: "Failed to fetch user" });
      }
    });

    // Increment profile view count
    app.patch("/users/:id/increment-view", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          // Silently fail if ID is invalid
          return res.status(200).send({ success: false });
        }

        // Fire-and-forget update
        usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $inc: { profileViews: 1 } }
        );

        res.status(200).send({ success: true });
      } catch (error) {
        // Don't send error to client, just log it
        console.error("Error incrementing profile view count:", error);
        res.status(200).send({ success: false }); // Still send success to not block client
      }
    });

    // PATCH route to update user's accountType
    app.patch("/users/:uid/accountType", verifyToken, async (req, res) => {
      try {
        const uid = req.params.uid;
        const { accountType } = req.body;

        if (!accountType) {
          return res.status(400).send({ error: "Missing accountType" });
        }

        const user = await usersCollection.findOne({ uid });
        if (!user) {
          return res.status(404).send({ error: "User not found" });
        }

        const updateData = { accountType };

        // If becoming a tutor and doesn't have a tutorId, generate one
        if (accountType === 'tutor' && !user.tutorId) {
          const lastTutor = await usersCollection.find({ tutorId: { $exists: true } }).sort({ tutorId: -1 }).limit(1).toArray();
          const newTutorId = lastTutor.length > 0 && lastTutor[0].tutorId ? lastTutor[0].tutorId + 1 : 10000;
          updateData.tutorId = newTutorId;
        }

        const result = await usersCollection.updateOne(
          { uid },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          // This case should technically not be hit due to the findOne check above, but for safety:
          return res.status(404).send({ error: "User not found" });
        }

        res.send({ message: `User updated to ${accountType}` });
      } catch (error) {
        console.error("Error updating accountType:", error);
        res.status(500).send({ error: "Failed to update accountType" });
      }
    });

    // PATCH route to verify user
    app.patch("/users/:uid/verify", verifyToken, async (req, res) => {
      try {
        const uid = req.params.uid;
        const { isVerified } = req.body;

        if (typeof isVerified !== "boolean") {
          return res
            .status(400)
            .send({ error: "Missing or invalid isVerified value" });
        }

        const result = await usersCollection.updateOne(
          { uid },
          { $set: { isVerified } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ error: "User not found" });
        }

        res.send({ message: `User verification updated to ${isVerified}` });
      } catch (error) {
        console.error("Error updating isVerified:", error);
        res.status(500).send({ error: "Failed to update isVerified" });
      }
    });
    // PATCH route to red verify user
    app.patch("/users/:uid/redVerify", verifyToken, async (req, res) => {
      try {
        const uid = req.params.uid;
        const { isRedVerified } = req.body;

        if (typeof isRedVerified !== "boolean") {
          return res
            .status(400)
            .send({ error: "Missing or invalid isRedVerified value" });
        }

        const result = await usersCollection.updateOne(
          { uid },
          { $set: { isRedVerified } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ error: "User not found" });
        }

        res.send({ message: `User verification updated to ${isRedVerified}` });
      } catch (error) {
        console.error("Error updating isRedVerified:", error);
        res.status(500).send({ error: "Failed to update isRedVerified" });
      }
    });

    // Delete user by uid
    app.delete("/users/:uid", verifyToken, async (req, res) => {
      try {
        const uid = req.params.uid;
        const result = await usersCollection.deleteOne({ uid });

        if (result.deletedCount === 0) {
          return res.status(404).send({ error: "User not found" });
        }

        res.send({ message: "User deleted successfully" });
      } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).send({ error: "Failed to delete user" });
      }
    });

    // tuition Requests

    app.post("/tuition-requests", async (req, res) => {
      try {
        const requestData = req.body;

        // Define only required fields
        const requiredFields = [
          "phoneNumber",
          "city",
          "location",
          "class",
          "subjects",
          "category",
          "tuitionType",
          "studentGender",
          "tutorGenderPreference",
          "salary",
          "daysPerWeek",
        ];

        const missing = requiredFields.filter((field) => !requestData[field]);
        if (missing.length > 0) {
          return res
            .status(400)
            .send({ error: `Missing required fields: ${missing.join(", ")}` });
        }

        // Optional field (no need to check)
        // requestData.additionalRequirements is optional

        const result = await tuitionRequestsCollection.insertOne(requestData);
        res.status(201).send({
          success: true,
          insertedId: result.insertedId,
          message: "Tuition request saved successfully",
        });
      } catch (error) {
        console.error("Error saving tuition request:", error);
        res.status(500).send({ error: "Failed to save tuition request" });
      }
    });

    // tuition get

    app.get("/tuition-requests", verifyToken, async (req, res) => {
      try {
        const allRequests = await tuitionRequestsCollection
          .find()
          .sort({ _id: -1 })
          .toArray();

        res.send(allRequests);
      } catch (error) {
        console.error("Error fetching tuition requests:", error);
        res.status(500).send({ error: "Failed to fetch tuition requests" });
      }
    });

    app.patch(
      "/tuition-requests/:id/call-status",
      verifyToken,
      async (req, res) => {
        const { id } = req.params;
        const { isCalled } = req.body;

        // Add ObjectId validation
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, error: "Invalid ID format." });
        }

        try {
          const result = await tuitionRequestsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { isCalled } }
          );

          if (result.modifiedCount === 1) {
            res.send({ success: true });
          } else {
            res.send({ success: false });
          }
        } catch (error) {
          console.error("Error updating call status:", error);
          res.status(500).send({ error: "Failed to update call status" });
        }
      }
    );

    // POST: Create a new hire request from a guardian
    app.post("/hire-requests", verifyToken, async (req, res) => {
      try {
        const guardianUid = req.user.uid; // Get guardian's UID from verified token
        const { 
          tutorId, 
          teacherSalary, 
          studentClass, 
          subjects, 
          daysPerWeek, 
          tuitionDuration, 
          availableTime, 
          requiredExperience, 
          guardianAddress, 
          guardianNumber 
        } = req.body;

        // Basic validation
        if (!tutorId || !teacherSalary || !studentClass || !subjects || !guardianAddress || !guardianNumber) {
          return res.status(400).send({ success: false, message: "Missing required fields." });
        }

        // Auto-incrementing hireRequestId
        const lastRequest = await hireRequestsCollection
          .find()
          .sort({ hireRequestId: -1 })
          .limit(1)
          .toArray();
        const hireRequestId = lastRequest.length > 0 && lastRequest[0].hireRequestId ? lastRequest[0].hireRequestId + 1 : 10000;

        const newHireRequest = {
          hireRequestId, // Add the sequential ID
          tutorId,       // The ID of the tutor being hired
          guardianUid, // The UID of the guardian making the request
          teacherSalary,
          studentClass,
          subjects,
          daysPerWeek,
          tuitionDuration,
          availableTime,
          requiredExperience,
          guardianAddress,
          guardianNumber,
          status: "pending", // Initial status
          demoClassStatus: "pending",
          createdAt: new Date(),
        };

        const result = await hireRequestsCollection.insertOne(newHireRequest);

        res.status(201).send({
          success: true,
          message: "Hire request submitted successfully.",
          insertedId: result.insertedId,
        });

      } catch (error) {
        console.error("Error creating hire request:", error);
        res.status(500).send({ success: false, message: "Failed to submit hire request." });
      }
    });

    // GET: Get all hire requests for the currently logged-in tutor
    app.get("/my-hire-requests", verifyToken, async (req, res) => {
      try {
        const tutorUid = req.user.uid;

        // First, find the tutor user to get their MongoDB _id
        const tutor = await usersCollection.findOne({ uid: tutorUid });
        if (!tutor || tutor.accountType !== 'tutor') {
          return res.status(403).send({ success: false, message: "Access denied. User is not a tutor." });
        }

        const tutorId = tutor._id.toString(); // Use the MongoDB _id as the reference

        const requests = await hireRequestsCollection.aggregate([
          {
            $match: { tutorId: tutorId } // Match requests for this tutor
          },
          {
            $lookup: {
              from: "users", // The collection to join with
              localField: "guardianUid", // Field from the hireRequests collection
              foreignField: "uid", // Field from the users collection
              as: "guardianDetails" // Output array field name
            }
          },
          {
            $unwind: "$guardianDetails" // Deconstruct the guardianDetails array
          },
          {
            $sort: { createdAt: -1 } // Show newest requests first
          }
        ]).toArray();

        res.status(200).send({ success: true, data: requests });

      } catch (error) {
        console.error("Error fetching hire requests:", error);
        res.status(500).send({ success: false, message: "Failed to fetch hire requests." });
      }
    });

        // PATCH: Update hire request status (accept, reject, pend)
        app.patch("/hire-requests/:id/status", verifyToken, async (req, res) => {
          try {
            const { id } = req.params;
            const { status: newStatus, rejectionReason } = req.body; // newStatus will be 'accepted', 'rejected', or 'pending'
            const userUid = req.user.uid;
    
            // 1. Validate input
            if (!['accepted', 'rejected', 'pending'].includes(newStatus)) {
              return res.status(400).send({ success: false, message: "Invalid status provided." });
            }
    
            if (!ObjectId.isValid(id)) {
              return res.status(400).send({ success: false, message: "Invalid request ID." });
            }
    
            // 2. Find the request
            const request = await hireRequestsCollection.findOne({ _id: new ObjectId(id) });
            if (!request) {
              return res.status(404).send({ success: false, message: "Hire request not found." });
            }
    
            // 3. Authorization Check
            const requestingUser = await usersCollection.findOne({ uid: userUid });
            if (!requestingUser || (requestingUser.accountType !== 'admin' && request.tutorId !== requestingUser._id.toString())) {
              return res.status(403).send({ success: false, message: "You are not authorized to perform this action." });
            }
    
            // 4. Prepare the update document
            const updateDoc = {
              $set: { status: newStatus, updatedAt: new Date() }
            };
            // If status is rejected, add the rejection reason
            if (newStatus === 'rejected' && rejectionReason) {
                updateDoc.$set.rejectionReason = rejectionReason;
            };
    
            // Add a trackingId if the request is being accepted for the first time
            if (newStatus === 'accepted' && !request.trackingId) {
              updateDoc.$set.trackingId = new ObjectId().toString();
            }
    
            // 5. Perform the update
            const result = await hireRequestsCollection.updateOne(
              { _id: new ObjectId(id) },
              updateDoc
            );
    
            if (result.modifiedCount === 0 && result.matchedCount === 0) {
                 return res.status(404).send({ success: false, message: "Hire request not found." });
            }
            
            // If status is the same, it's not an error.
            if (result.modifiedCount === 0 && result.matchedCount === 1) {
                return res.status(200).send({ success: true, message: `Request status is already ${newStatus}.` });
            }
    
            // 6. Send success response
            const updatedRequest = await hireRequestsCollection.findOne({ _id: new ObjectId(id) });
            res.status(200).send({ 
                success: true, 
                message: `Request has been ${newStatus}.`,
                data: updatedRequest 
            });
    
          } catch (error) {
            console.error(`Error updating hire request status:`, error);
            res.status(500).send({ success: false, message: `Failed to update hire request.` });
          }
        });
    // GET: Get ALL hire requests (Admin only) with pagination and filtering
    app.get("/all-hire-requests", verifyToken, async (req, res) => {
      try {
        // Admin role verification
        const requestingUser = await usersCollection.findOne({ uid: req.user.uid });
        if (!requestingUser || requestingUser.accountType !== 'admin') {
          return res.status(403).send({ success: false, message: "Access denied. Admin role required." });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Filters
        const { status, tutorSearch, guardianSearch, hireRequestIdSearch } = req.query;

        let aggregationPipeline = [];

        // Initial match for fields in hireRequestsCollection
        const initialMatch = {};
        if (hireRequestIdSearch) {
            const numericId = parseInt(hireRequestIdSearch, 10);
            if (!isNaN(numericId)) {
                initialMatch.hireRequestId = numericId;
            }
        }
        if (status) {
          initialMatch.status = status;
        }
        if (Object.keys(initialMatch).length > 0) {
            aggregationPipeline.push({ $match: initialMatch });
        }
        
        // Add sorting
        aggregationPipeline.push({ $sort: { createdAt: -1 } });

        // Lookups
        aggregationPipeline.push(
            { $addFields: { tutorObjectId: { $toObjectId: "$tutorId" } } },
            { $lookup: { from: "users", localField: "guardianUid", foreignField: "uid", as: "guardianDetails" } },
            { $lookup: { from: "users", localField: "tutorObjectId", foreignField: "_id", as: "tutorDetails" } },
            { $unwind: { path: "$guardianDetails", preserveNullAndEmptyArrays: true } },
            { $unwind: { path: "$tutorDetails", preserveNullAndEmptyArrays: true } }
        );

        // Secondary match for fields from looked-up collections
        const secondaryMatch = {};
        if (tutorSearch) {
            secondaryMatch['tutorDetails.name'] = { $regex: tutorSearch, $options: 'i' };
        }
        if (guardianSearch) {
            secondaryMatch['guardianDetails.name'] = { $regex: guardianSearch, $options: 'i' };
        }
         if (Object.keys(secondaryMatch).length > 0) {
            aggregationPipeline.push({ $match: secondaryMatch });
        }

        // Add a projection to exclude sensitive fields and ensure hireRequestId is present
        aggregationPipeline.push({
            $project: {
                // Exclude sensitive fields
                "guardianDetails.password": 0, 
                "tutorDetails.password": 0,
                // You can add other fields to exclude here if needed
            }
            // Since we are only excluding, all other fields, including hireRequestId,
            // will be passed through automatically. If you were including fields,
            // you would need to explicitly add `hireRequestId: 1`.
            // This exclusion-only approach is safer to ensure new fields are not missed.
        });

        // Facet for pagination
        aggregationPipeline.push({
          $facet: {
            paginatedResults: [{ $skip: skip }, { $limit: limit }],
            totalCount: [{ $count: 'count' }]
          }
        });

        const result = await hireRequestsCollection.aggregate(aggregationPipeline).toArray();

        const requests = result[0].paginatedResults;
        const totalCount = result[0].totalCount.length > 0 ? result[0].totalCount[0].count : 0;
        const totalPages = Math.ceil(totalCount / limit);

        res.status(200).send({
          success: true,
          data: requests,
          pagination: { totalCount, totalPages, currentPage: page, limit }
        });

      } catch (error) {
        console.error("Error fetching all hire requests:", error);
        res.status(500).send({ success: false, message: "Failed to fetch hire requests." });
      }
    });

    // GET: Get all accepted hire requests for the currently logged-in guardian
    app.get("/my-hired-tutors", verifyToken, async (req, res) => {
      try {
        const guardianUid = req.user.uid;

        const requests = await hireRequestsCollection.aggregate([
          {
            $match: { 
              guardianUid: guardianUid
            }
          },
          {
            $addFields: {
              tutorObjectId: { $toObjectId: "$tutorId" } 
            }
          },
          {
            $lookup: {
              from: "users",
              localField: "tutorObjectId",
              foreignField: "_id",
              as: "tutorDetails"
            }
          },
          {
            $unwind: "$tutorDetails"
          },
          {
            $project: {
              _id: 1,
              status: 1,
              subjects: 1,
              teacherSalary: 1,
              guardianUid: 1,
              tutorId: 1,
              createdAt: 1,
              updatedAt: 1,
              trackingId: 1, // Add trackingId here
              rejectionReason: 1, // Add rejectionReason here
              "tutorDetails.name": 1,
              "tutorDetails.image": 1,
              "tutorDetails.institute": 1,
              "tutorDetails.tutorId": 1,
              "tutorDetails.phone": 1,
              "tutorDetails.email": 1,
              "tutorDetails.department": 1,
              "tutorDetails.location": 1,
              "tutorDetails._id": 1
            }
          },
          {
            $sort: { updatedAt: -1 } // Show most recently accepted first
          }
        ]).toArray();

        res.status(200).send({ success: true, data: requests });

      } catch (error) {
        console.error("Error fetching hired tutors:", error);
        res.status(500).send({ success: false, message: "Failed to fetch hired tutors." });
      }
    });

    // GET: Get hire request details by trackingId (Publicly accessible)
    app.get("/hire-requests/track/:trackingId", async (req, res) => {
      try {
        const { trackingId } = req.params;

        const request = await hireRequestsCollection.aggregate([
          {
            $match: { trackingId: trackingId }
          },
          {
            $addFields: {
              tutorObjectId: { $toObjectId: "$tutorId" } 
            }
          },
          {
            $lookup: {
              from: "users",
              localField: "tutorObjectId",
              foreignField: "_id",
              as: "tutorDetails"
            }
          },
          {
            $unwind: { path: "$tutorDetails", preserveNullAndEmptyArrays: true }
          },
          {
            $project: {
              _id: 1,
              status: 1,
              subjects: 1,
              teacherSalary: 1,
              guardianUid: 1,
              tutorId: 1,
              createdAt: 1,
              updatedAt: 1,
              trackingId: 1,
              "tutorDetails.name": 1,
              "tutorDetails.image": 1,
              "tutorDetails.institute": 1,
              "tutorDetails.tutorId": 1,
              "tutorDetails.phone": 1,
              "tutorDetails.email": 1,
              "tutorDetails.department": 1,
              "tutorDetails.location": 1,
              "tutorDetails._id": 1
            }
          }
        ]).toArray();

        if (request.length === 0) {
          return res.status(404).send({ success: false, message: "Tracking ID not found." });
        }

        res.status(200).send({ success: true, data: request[0] });

      } catch (error) {
        console.error("Error fetching hire request by tracking ID:", error);
        res.status(500).send({ success: false, message: "Failed to fetch hire request." });
      }
    });

    // GET: Get full tracking details by trackingId (for tracking page)
    app.get('/tracking/:trackingId', async (req, res) => {
      try {
          const { trackingId } = req.params;

          // The query should find the document where the 'trackingId' field matches.
          const hireRequest = await hireRequestsCollection.findOne({ trackingId: trackingId });

          if (!hireRequest) {
              return res.status(404).send({ success: false, message: 'Tracking session not found.' });
          }

          // Fetch tutor and guardian details
          const tutor = await usersCollection.findOne({ _id: new ObjectId(hireRequest.tutorId) });
          const guardian = await usersCollection.findOne({ uid: hireRequest.guardianUid });

          res.status(200).send({
              success: true,
              data: {
                  ...hireRequest,
                  tutorDetails: { name: tutor?.name, _id: tutor?._id },
                  guardianDetails: { name: guardian?.name, _id: guardian?._id }
              }
          });

      } catch (error) {
          console.error("Error fetching tracking details:", error);
          res.status(500).send({ success: false, message: "Failed to fetch tracking details." });
      }
    });

    // POST: Add an update to a tracking session
    app.post('/tracking/:trackingId/update', verifyToken, async (req, res) => {
      try {
          const { trackingId } = req.params;
          const { message } = req.body;
          const requestingUserUid = req.user.uid;

          if (!message || typeof message !== 'string' || message.trim() === '') {
              return res.status(400).send({ success: false, message: 'Update message is required.' });
          }

          // Find the hire request using the string trackingId
          const hireRequest = await hireRequestsCollection.findOne({ trackingId: trackingId });

          if (!hireRequest) {
              return res.status(404).send({ success: false, message: 'Tracking session not found.' });
          }

          // Find the user who is making the request
          const requestingUser = await usersCollection.findOne({ uid: requestingUserUid });
          if (!requestingUser) {
              return res.status(404).send({ success: false, message: 'Requesting user not found.' });
          }

          // Find the assigned tutor for this hire request
          const tutorUser = await usersCollection.findOne({ _id: new ObjectId(hireRequest.tutorId) });

          // Authorize if the user is an admin OR the assigned tutor
          if (requestingUser.accountType !== 'admin' && (!tutorUser || tutorUser.uid !== requestingUserUid)) {
              return res.status(403).send({ success: false, message: 'You are not authorized to post updates for this session.' });
          }

          const newUpdate = {
              _id: new ObjectId(),
              message: message.trim(),
              timestamp: new Date(),
              author: { name: requestingUser.name } // Store author's name (can be tutor or admin)
          };

          const result = await hireRequestsCollection.updateOne(
              { trackingId: trackingId }, // Find by trackingId to update
              { $push: { updates: newUpdate } }
          );

          if (result.modifiedCount === 0) {
              return res.status(500).send({ success: false, message: 'Failed to post the update.' });
          }

          res.status(201).send({ success: true, message: 'Update posted successfully.', data: newUpdate });

      } catch (error) {
          console.error("Error posting tracking update:", error);
          res.status(500).send({ success: false, message: "Failed to post tracking update." });
      }
    });

    // PATCH: Update demo class status
    app.patch("/hire-requests/:trackingId/demo-status", verifyToken, async (req, res) => {
      try {
        const { trackingId } = req.params;
        const { status } = req.body;
        const requestingUserUid = req.user.uid;

        if (!['confirmed', 'canceled'].includes(status)) {
          return res.status(400).send({ success: false, message: 'Invalid status.' });
        }

        const hireRequest = await hireRequestsCollection.findOne({ trackingId: trackingId });

        if (!hireRequest) {
          return res.status(404).send({ success: false, message: 'Hire request not found.' });
        }

        // Find the user who is making the request
        const requestingUser = await usersCollection.findOne({ uid: requestingUserUid });
        if (!requestingUser) {
            return res.status(404).send({ success: false, message: 'Requesting user not found.' });
        }

        // Find the assigned tutor for this hire request
        const tutorUser = await usersCollection.findOne({ _id: new ObjectId(hireRequest.tutorId) });

        // Authorize if the user is an admin OR the assigned tutor
        if (requestingUser.accountType !== 'admin' && (!tutorUser || tutorUser.uid !== requestingUserUid)) {
            return res.status(403).send({ success: false, message: 'You are not authorized to update this hire request.' });
        }

        const result = await hireRequestsCollection.updateOne(
          { trackingId: trackingId },
          { $set: { demoClassStatus: status } }
        );

        if (result.modifiedCount === 0) {
          return res.status(500).send({ success: false, message: 'Failed to update demo class status.' });
        }

        res.status(200).send({ success: true, message: `Demo class status updated to ${status}.` });

      } catch (error) {
        console.error("Error updating demo class status:", error);
        res.status(500).send({ success: false, message: "Failed to update demo class status." });
      }
    });


    // job-requests

    app.post("/job-requests", async (req, res) => {
      try {
        const {
          jobTitle,
          tuitionType,
          category,
          studentGender,
          city,
          location,
          class: classLevel,
          subjects,
          daysPerWeek,
          tutorGenderPreference,
          salary,
          studentsNumber,
          tutoringTime,
          guardianNumber,
          postedBy,
        } = req.body;

        const requiredFields = [
          "jobTitle",
          "tuitionType",
          "category",
          "studentGender",
          "city",
          "location",
          "class",
          "subjects",
          "daysPerWeek",
          "tutorGenderPreference",
          "salary",
          "studentsNumber",
          "tutoringTime",
          "guardianNumber",
        ];

        const missing = requiredFields.filter((field) => !req.body[field]);
        if (missing.length > 0) {
          return res.status(400).send({
            success: false,
            message: `Missing required fields: ${missing.join(", ")}`,
          });
        }

        // ✅ Auto-incrementing jobId
        const lastJob = await jobsCollection
          .find()
          .sort({ jobId: -1 })
          .limit(1)
          .toArray();
        const jobId =
          lastJob.length > 0 && lastJob[0].jobId ? lastJob[0].jobId + 1 : 50000;

        const dateObj = new Date();
        const postedDate = dateObj.toLocaleDateString("en-US", {
          month: "short",
          day: "2-digit",
          year: "numeric",
        });

        const subjectsArray = Array.isArray(subjects)
          ? subjects
          : subjects.split(",").map((s) => s.trim());

        const newJob = {
          jobId,
          title: jobTitle,
          type: tuitionType,
          category,
          studentGender,
          classLevel,
          subjects: subjectsArray,
          daysPerWeek,
          tutorGenderPreference,
          salary: Number(salary),
          studentsNumber: Number(studentsNumber),
          tutoringTime,
          guardianNumber, // Added guardianNumber
          location: `${location}, ${city}`,
          city,
          date: postedDate,
          dateObj,
          postedBy, // Add admin info
        };

        const result = await jobsCollection.insertOne(newJob);

        // ===========================
        // 🔔 SEND PUSH NOTIFICATIONS (Including Anonymous Users)
        // ===========================
        try {
          // Find ONLY logged-in tutors with FCM tokens (no anonymous users)
          const matchingTokens = await notificationTokensCollection
            .find({ 
              city: city,
              fcmToken: { $exists: true },
              isActive: true,
              userId: { $exists: true, $ne: null },  // Must have userId (logged in)
              isAnonymous: false  // Not anonymous
            })
            .toArray();

          // Also check users collection for backward compatibility
          const matchingTutors = await usersCollection
            .find({ 
              accountType: "tutor",
              city: city,
              fcmToken: { $exists: true },
              notificationEnabled: { $ne: false }
            })
            .toArray();

          // Combine both sources and remove duplicates
          const allTokensMap = new Map();
          
          // Add from notificationTokens collection
          matchingTokens.forEach(token => {
            allTokensMap.set(token.fcmToken, {
              fcmToken: token.fcmToken,
              deviceType: token.deviceType,
              userId: token.userId
            });
          });

          // Add from users collection (if not already in map)
          matchingTutors.forEach(tutor => {
            if (!allTokensMap.has(tutor.fcmToken)) {
              allTokensMap.set(tutor.fcmToken, {
                fcmToken: tutor.fcmToken,
                deviceType: tutor.deviceType,
                userId: tutor.uid
              });
            }
          });

          const allRecipients = Array.from(allTokensMap.values());

          if (allRecipients.length > 0) {
            console.log(`📤 Sending notifications to ${allRecipients.length} logged tutors in ${city}`);
            
            // Add the _id to newJob for notification
            newJob._id = result.insertedId;
            
            // Send OneSignal notifications to city-tagged users
            const heading = `নতুন টিউশন: ${className || 'ক্লাস'} - ${subject || 'বিষয়'}`;
            const content = `${city} এলাকায় নতুন টিউশন পোস্ট হয়েছে। বেতন: ${salary || 'আলোচনাসাপেক্ষে'} টাকা`;
            
            sendOneSignalNotification(
              [{ field: 'tag', key: 'city', relation: '=', value: city }],
              heading,
              content,
              { 
                url: `https://searchtutorbd.com/job/${result.insertedId}`,
                jobId: result.insertedId.toString(),
                city: city,
                className: className,
                subject: subject
              }
            ).then(oneSignalResult => {
              if (oneSignalResult.success) {
                console.log(`✅ OneSignal notifications sent to ${oneSignalResult.data.recipients || 0} users`);
              } else {
                console.error(`❌ OneSignal notification failed:`, oneSignalResult.error);
              }
            }).catch(err => {
              console.error("❌ OneSignal error:", err);
            });

            // Also send FCM notifications (fallback/backward compatibility)
            sendPushNotifications(allRecipients, newJob)
              .then(notifResult => {
                console.log(`✅ FCM Notification result: ${notifResult.success} sent, ${notifResult.failed} failed`);
              })
              .catch(err => {
                console.error("❌ FCM Notification error:", err);
              });
          } else {
            console.log(`📭 No users found in ${city} with FCM tokens`);
          }
        } catch (notifError) {
          console.error("❌ Error in notification process:", notifError);
          // Don't fail the job post if notification fails
        }

        res.status(201).send({
          success: true,
          message: "Tuition job posted successfully",
          insertedId: result.insertedId,
          jobId: jobId,
        });
      } catch (error) {
        console.error("Error posting job:", error);
        res.status(500).send({
          success: false,
          message: "Failed to post tuition job",
        });
      }
    });

    // GET all job posts
    // app.get("/Alljobs", async (req, res) => {
    //   const jobs = await jobsCollection.find().toArray();
    //     res.send(jobs);
    // });
    // for notifications api
    // GET recent 6 jobs matching user city
    app.get("/jobs/notifications/:city", async (req, res) => {
      try {
        const userCity = req.params.city;
        if (!userCity) return res.status(400).send({ success: false, error: "City is required" });

        // Fetch the 6 most recent jobs matching user's city
        const jobs = await jobsCollection
          .find({ city: userCity })  // or use regex if partial match: { city: { $regex: userCity, $options: "i" } }
          .sort({ dateObj: -1 })      // newest first
          .limit(3)
          .toArray();

        res.send({ success: true, data: jobs });
      } catch (error) {
        console.error("Error fetching job notifications:", error);
        res.status(500).send({ success: false, error: "Failed to fetch notifications" });
      }
    });



    app.get("/jobs", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const city = req.query.city;
        const search = req.query.search;

        let filter = {};

        if (city) {
          filter.city = city;
        }

            if (search) {
              filter.$or = [
                {
                  $expr: {
                    $regexMatch: {
                      input: { $toString: "$jobId" },
                      regex: search,
                      options: "i",
                    },
                  },
                },
                {
                  guardianNumber: { $regex: search, $options: "i" },
                },
              ];
            }
        const totalJobs = await jobsCollection.countDocuments(filter);

        const jobs = await jobsCollection
          .find(filter)
          .sort({ _id: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.status(200).send({
          success: true,
          data: jobs,
          totalJobs,
          totalPages: Math.ceil(totalJobs / limit),
          currentPage: page,
        });
      } catch (error) {
        console.error("Error fetching jobs:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch jobs",
        });
      }
    });

    // GET a single job post by ID
    app.get("/jobs/:id", async (req, res) => {
      try {
        const { id } = req.params;

        // More robust check for a valid 24-character hex string ObjectId
        if (!ObjectId.isValid(id) || String(id).length !== 24) {
          return res.status(400).send({
            success: false,
            message: "Invalid job ID format.",
          });
        }

        const job = await jobsCollection.findOne({ _id: new ObjectId(id) });

        if (!job) {
          return res.status(404).send({
            success: false,
            message: "Job not found",
          });
        }

        res.status(200).send({
          success: true,
          data: job,
        });
      } catch (error) {
        // Log the specific error for debugging
        console.error("Error fetching job by ID:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch job due to an internal server error.",
        });
      }
    });

    // DELETE a job post by ID
    app.delete("/jobs/:id", async (req, res) => {
      try {
        const id = req.params.id;

        // Add ObjectId validation for robustness
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid ID format." });
        }

        const result = await jobsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "Job not found",
          });
        }

        res.status(200).send({
          success: true,
          message: "Job deleted successfully",
        });
      } catch (error) {
        console.error("Error deleting job:", error);
        res.status(500).send({
          success: false,
          message: "Failed to delete job",
        });
      }
    });

    // POST: Apply to a job


    app.post("/applications", verifyToken, async (req, res) => {
      const { jobId, userId, userEmail } = req.body;

      if (!jobId || !userId || !userEmail) {
        return res
          .status(400)
          .send({ error: "Missing jobId, userId or userEmail" });
      }

      const existing = await applicationsCollection.findOne({ jobId, userId });

      if (existing) {
        return res.status(400).send({ error: "Already applied" });
      }

      const result = await applicationsCollection.insertOne({
        jobId,
        userId,
        userEmail,
        appliedAt: new Date(),
        status: "pending",
      });

      res.send({ success: true, insertedId: result.insertedId });
    });




    app.put("/applications/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { reason, comments } = req.body;

        if (!["Pending", "Cancel", "Appointed"].includes(reason)) {
          return res.status(400).send({ success: false, error: "Invalid reason" });
        }

        // BUG FIX: This endpoint should update the 'applications' collection, not 'jobs'.
        const result = await applicationsCollection.updateOne(
          { _id: new ObjectId(id) }, // Find the application by its own _id
          {
            $set: {
              status: reason, // Update the application's status
              feedback: comments, // Add feedback to the application
              updatedAt: new Date(),
            },
          }
        );
        if (result.matchedCount === 0) {
          return res.status(404).send({ success: false, error: "Application not found" });
        }

        res.send({ success: true, updatedFields: { status: reason, feedback: comments } });
      } catch (error) {
        res.status(500).send({ success: false, error: error.message });
      }
    });

    // GET: Check if a user has applied for a job
    app.get("/applications/check", verifyToken, async (req, res) => {
      const { jobId, userId } = req.query;

      if (!jobId || !userId) {
        return res.status(400).send({ error: "Missing jobId or userId" });
      }

      const applied = await applicationsCollection.findOne({ jobId, userId });

      res.send({ hasApplied: !!applied });
    });

    // Get applications by userId

    app.get("/applications/user/:userId", verifyToken, async (req, res) => {
      try {
        const userId = req.params.userId;

        const appliedJobsWithStatus = await applicationsCollection
          .aggregate([
            {
              $match: { userId: userId },
            },
            {
              $addFields: {
                jobIdObj: { $toObjectId: "$jobId" }, // convert string to ObjectId
              },
            },
            {
              $lookup: {
                from: "jobs",
                localField: "jobIdObj",
                foreignField: "_id",
                as: "jobDetails",
              },
            },
            {
              $unwind: "$jobDetails",
            },
            // Instead of replaceRoot, project a combined object
            {
              $project: {
                _id: 1,
                status: 1,
                appliedAt: 1,
                job: "$jobDetails",
              },
            },
          ])
          .toArray();

        res.json(appliedJobsWithStatus);
      } catch (error) {
        console.error("Error fetching applied jobs:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // PATCH: Admin updates application status // old update funtionilitys
    // app.patch("/applications/:id/status", verifyToken, async (req, res) => {
    //   const { id } = req.params;
    //   const { status } = req.body;

    //   const validStatuses = ["pending", "reviewed", "selected", "rejected"];
    //   if (!status || !validStatuses.includes(status)) {
    //     return res.status(400).json({ error: "Invalid or missing status" });
    //   }

    //   try {
    //     const result = await applicationsCollection.updateOne(
    //       { _id: new ObjectId(id) },
    //       { $set: { status } }
    //     );

    //     if (result.matchedCount === 0) {
    //       return res.status(404).json({ error: "Application not found" });
    //     }

    //     res.json({ success: true, message: `Status updated to \"${status}\"" });
    //   } catch (error) {
    //     console.error("Error updating application status:", error);
    //     res.status(500).json({ error: "Server error" });
    //   }
    // });

    // PATCH update application status  // latest update funtionilitys
    app.patch("/applications/:id/status", verifyToken, async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      try {
        // Find the application first
        const application = await applicationsCollection.findOne({ _id: new ObjectId(id) });

        if (!application) {
          return res.status(404).json({ error: "Application not found" });
        }

        const jobId = application.jobId;

        // 1. Update this application
        await applicationsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        // 2. If status is "selected"
        if (status === "selected") {
          await applicationsCollection.updateMany(
            {
              jobId: jobId,
              _id: { $ne: new ObjectId(id) }, // exclude selected person
              status: { $ne: "reviewed" } // keep shortlisted as is
            },
            { $set: { status: "rejected" } }
          );
        }

        res.json({ success: true, message: "Status updated successfully" });
      } catch (error) {
        console.error("Error updating status:", error);
        res.status(500).json({ error: "Server error" });
      }
    });


    // GET: Get selected tutors with full details
    app.get("/selected-tutors", verifyToken, async (req, res) => {
      try {
        const selectedApplications = await applicationsCollection.aggregate([
          {
            $match: { status: "selected" }
          },
          {
            $addFields: {
              jobIdObj: { $toObjectId: "$jobId" }
            }
          },
          {
            $lookup: {
              from: "users",
              localField: "userId",
              foreignField: "uid",
              as: "userDetails"
            }
          },
          {
            $lookup: {
              from: "jobs",
              localField: "jobIdObj",
              foreignField: "_id",
              as: "jobDetails"
            }
          },
          {
            $unwind: "$userDetails"
          },
          {
            $unwind: "$jobDetails"
          },
          {
            $sort: { appliedAt: -1 }
          }
        ]).toArray();

        res.json({
          success: true,
          applications: selectedApplications
        });
      } catch (error) {
        console.error("Error fetching selected tutors:", error);
        res.status(500).json({ success: false, error: "Server error" });
      }
    });

    // GET: Get all applications with user and job info for admin
    app.get("/applications", verifyToken, async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search;
        const skip = (page - 1) * limit;
    
        let aggregationPipeline = [];
    
        // Stage 1: Match jobs based on search criteria
        if (search) {
          aggregationPipeline.push({
            $match: {
              $or: [
                { title: { $regex: search, $options: "i" } },
                { guardianNumber: { $regex: search, $options: "i" } },
                {
                  $expr: {
                    $regexMatch: {
                      input: { $toString: "$jobId" },
                      regex: search,
                      options: "i",
                    },
                  },
                },
              ],
            },
          });
        }
    
        // Stage 2: Sort jobs (e.g., by creation date)
        aggregationPipeline.push({
          $sort: { _id: -1 },
        });
    
        // Stage 3: Lookup applications for each job
        aggregationPipeline.push({
          $lookup: {
            from: "applications",
            let: { jobIdStr: { $toString: "$_id" } },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: ["$jobId", "$$jobIdStr"],
                  },
                },
              },
              { $count: "count" },
            ],
            as: "applicationData",
          },
        });
    
        // Stage 4: Project the final shape
        aggregationPipeline.push({
          $project: {
            _id: 1,
            jobTitle: "$title",
            guardianNumber: "$guardianNumber",
            jobId: "$jobId",
            applicationCount: { $ifNull: [{ $first: "$applicationData.count" }, 0] },
          },
        });
    
        // Stage 5: Facet for pagination and total count
        aggregationPipeline.push({
          $facet: {
            paginatedResults: [{ $skip: skip }, { $limit: limit }],
            totalCount: [{ $count: "count" }],
          },
        });
    
        // Execute the aggregation on the 'jobs' collection
        const result = await jobsCollection.aggregate(aggregationPipeline).toArray();
    
        const applications = result[0].paginatedResults;
        const totalCount = result[0].totalCount.length > 0 ? result[0].totalCount[0].count : 0;
        const totalPages = Math.ceil(totalCount / limit);
    
        res.json({
          applications,
          totalPages,
        });
    
      } catch (error) {
        console.error("Error fetching applications:", error);
        res.status(500).json({ error: "Server error" });
      }
    });

    app.get("/applications/:jobId", verifyToken, async (req, res) => {
      try {
        const jobId = req.params.jobId;

        // Find the job by numeric jobId
        const job = await jobsCollection.findOne({ jobId: parseInt(jobId) });
        if (!job) {
          return res.status(404).json({ error: "Job not found" });
        }

        const applications = await applicationsCollection.aggregate([
          {
            $match: {
              jobId: job._id.toString() // Match by the ObjectId of the job
            }
          },
          {
            $lookup: {
              from: "users",
              localField: "userId",
              foreignField: "uid",
              as: "userDetails"
            }
          },
          {
            $unwind: "$userDetails"
          },
          {
            $sort: { _id: -1 }
          }
        ]).toArray();

        res.json({
          job,
          applications
        });

      } catch (error) {
        console.error("Error fetching applications by jobId:", error);
        res.status(500).json({ error: "Server error" });
      }
    });

    // PATCH: Update payment status
    app.patch("/applications/:id/payment", verifyToken, async (req, res) => {
      const { id } = req.params;
      const { paymentStatus } = req.body;

      const validStatuses = ["unpaid", "paid", "pending"];
      if (!paymentStatus || !validStatuses.includes(paymentStatus)) {
        return res
          .status(400)
          .json({ error: "Invalid or missing paymentStatus" });
      }

      try {
        const result = await applicationsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { paymentStatus } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: "Application not found" });
        }

        res.json({
          success: true,
          message: `Payment status updated to "${paymentStatus}"`,
        });
      } catch (error) {
        console.error("Error updating payment status:", error);
        res.status(500).json({ error: "Server error" });
      }
    });

    function verifyToken(req, res, next) {
      // Authorization header থেকে token নাও
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res
          .status(401)
          .json({ error: "Unauthorized: No token provided" });
      }

      const token = authHeader.split(" ")[1];

      jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ error: "Invalid token" });
        req.user = decoded;
        next();
      });
    }

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log( // This log will now appear after explicit connection
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}

app.get("/", (req, res) => {
  res.send("search teacher is live");
});

// Test notification endpoint
app.post("/test-notification", async (req, res) => {
  try {
    const { city, title, body } = req.body;
    
    // Default values if not provided
    const notificationCity = city || "ঢাকা";
    const notificationTitle = title || "🔔 Test Notification";
    const notificationBody = body || "এটি একটি test notification। আপনার notification system কাজ করছে!";

    console.log(`📤 Sending test notification to city: ${notificationCity}`);

    // Get all FCM tokens for the specified city
    const tokens = await notificationTokensCollection
      .find({
        city: notificationCity,
        userId: { $exists: true, $ne: null },
        isAnonymous: false
      })
      .toArray();

    if (tokens.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No active users found in ${notificationCity} with notifications enabled`
      });
    }

    console.log(`📱 Found ${tokens.length} devices to notify`);

    const fcmTokens = tokens.map(t => t.fcmToken);
    const message = {
      notification: {
        title: notificationTitle,
        body: notificationBody,
      },
      data: {
        type: 'test',
        city: notificationCity,
        timestamp: new Date().toISOString()
      },
      tokens: fcmTokens
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    console.log(`✅ Test notification sent: ${response.successCount} success, ${response.failureCount} failed`);

    // Also send OneSignal test notification
    try {
      const oneSignalResult = await sendOneSignalNotification(
        [{ field: 'tag', key: 'city', relation: '=', value: notificationCity }],
        notificationTitle,
        notificationBody,
        { type: 'test', city: notificationCity, timestamp: new Date().toISOString() }
      );
      
      if (oneSignalResult.success) {
        console.log(`✅ OneSignal test sent to ${oneSignalResult.data.recipients || 0} users`);
      }
    } catch (err) {
      console.error('❌ OneSignal test failed:', err);
    }

    res.json({
      success: true,
      message: "Test notification sent successfully",
      stats: {
        totalDevices: tokens.length,
        successCount: response.successCount,
        failureCount: response.failureCount,
        city: notificationCity
      }
    });

  } catch (error) {
    console.error("❌ Error sending test notification:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Debug endpoint - Check user's notification status
app.get("/check-notification-status/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Check in notificationTokens collection
    const tokens = await notificationTokensCollection
      .find({ userId: userId })
      .toArray();

    // Check in users collection
    const user = await usersCollection.findOne({ uid: userId });

    res.json({
      success: true,
      userId: userId,
      tokensInCollection: tokens.length,
      tokens: tokens.map(t => ({
        fcmToken: t.fcmToken.substring(0, 20) + '...',
        city: t.city,
        deviceType: t.deviceType,
        isActive: t.isActive,
        isAnonymous: t.isAnonymous,
        createdAt: t.createdAt
      })),
      userProfile: user ? {
        city: user.city,
        accountType: user.accountType,
        notificationEnabled: user.notificationEnabled,
        hasFCMToken: !!user.fcmToken
      } : null
    });

  } catch (error) {
    console.error("❌ Error checking notification status:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Commented out - requires verifyJWT middleware
// // Get current logged user info (no need for userId in URL)
// app.get("/my-notification-status", verifyJWT, async (req, res) => {
//   try {
//     const userId = req.decoded.uid;

//     // Check in notificationTokens collection
//     const tokens = await notificationTokensCollection
//       .find({ userId: userId })
//       .toArray();

//     // Check in users collection
//     const user = await usersCollection.findOne({ uid: userId });

//     res.json({
//       success: true,
//       userId: userId,
//       userName: user?.name || 'Unknown',
//       tokensInCollection: tokens.length,
//       tokens: tokens.map(t => ({
//         fcmToken: t.fcmToken.substring(0, 20) + '...',
//         city: t.city,
//         deviceType: t.deviceType,
//         isActive: t.isActive,
//         isAnonymous: t.isAnonymous,
//         createdAt: t.createdAt
//       })),
//       userProfile: user ? {
//         city: user.city,
//         accountType: user.accountType,
//         notificationEnabled: user.notificationEnabled,
//         hasFCMToken: !!user.fcmToken
//       } : null
//     });

//   } catch (error) {
//     console.error("❌ Error checking notification status:", error);
//     res.status(500).json({
//       success: false,
//       error: error.message
//     });
//   }
// });

app.listen(port, () => {
  console.log(`search teacher is sitting on port ${port}`);
});

const ready = run().catch((error) => {
  console.error("Failed to initialize application:", error);
  throw error;
});

module.exports = async (req, res) => {
  await ready;
  return app(req, res);
};
