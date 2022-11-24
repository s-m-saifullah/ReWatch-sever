const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// middlewares
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Rewatch Server Running");
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.f1cm5cm.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

// JWT Verify
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader.split(" ")[1];
  if (token === "null") {
    return res.status(401).send("Unauthorized Access");
  }

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Forbidden Access" });
    }
    req.decoded = decoded;
  });
  next();
};

async function run() {
  try {
    const usersCollection = client.db("rewatch").collection("users");
    const categoriesCollection = client
      .db("rewatch")
      .collection("watchCategories");

    //   Get Categories
    app.get("/categories", async (req, res) => {
      const query = {};
      const categories = await categoriesCollection.find(query).toArray();
      res.send(categories);
    });

    // Add user
    app.post("/users", async (req, res) => {
      const user = req.body;
      const users = await usersCollection
        .find()
        .project({ email: 1 })
        .toArray();

      const userEmails = users.map((user) => user.email);
      console.log();

      if (userEmails.includes(user.email)) {
        return res.send({ message: `Welcome Back ${user.name}` });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // Issue JWT Token
    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN_SECRET, {
          expiresIn: "1h",
        });
        return res.send({ accessToken: token });
      }
      return res.status(403).send({ accessToken: "" });
    });
  } finally {
  }
}

run().catch((err) => console.log(err));

app.listen(port, console.log(`Rewatch Server is Running on Port ${port}`));
