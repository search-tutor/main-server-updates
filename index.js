require("dotenv").config();
const express = require("express");
const app = express();
const jwt = require("jsonwebtoken");
const cors = require("cors");
const port = process.env.PORT || 4000;

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
    const usersCollection = db.collection("users");
    const tuitionRequestsCollection = db.collection("tuitionRequests");
    const jobsCollection = db.collection("jobs");
    const applicationsCollection = db.collection("applications");
    const hireRequestsCollection = db.collection("hireRequests");

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

    app.get("/users", verifyToken, async (req, res) => {
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
          return res.status(400).send({ error: "User already exists" });
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
        };

        const result = await jobsCollection.insertOne(newJob);

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


    // GET: Get all applications with user and job info for admin
    app.get("/applications", verifyToken, async (req, res) => {
      try {
        const allApplications = await applicationsCollection
          .aggregate([
            {
              $match: {
                jobId: { $regex: /^[0-9a-fA-F]{24}$/ },
              },
            },
            {
              $addFields: {
                jobIdObj: { $toObjectId: "$jobId" },
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
            { $unwind: "$jobDetails" },
            {
              $lookup: {
                from: "users",
                localField: "userId",
                foreignField: "uid",
                as: "userDetails",
              },
            },
            { $unwind: "$userDetails" },
            { $sort: { _id: -1 } },
          ])
          .toArray();

        res.json(allApplications);
      } catch (error) {
        console.error("Error fetching applications:", error);
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
// app.listen(port, () => {
//   console.log(`search teacher is sitting on port ${port}`);
// });

const ready = run().catch((error) => {
  console.error("Failed to initialize application:", error);
  throw error;
});

module.exports = async (req, res) => {
  await ready;
  return app(req, res);
};
