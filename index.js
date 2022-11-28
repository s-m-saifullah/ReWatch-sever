const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
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
      console.log(err);
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
    const productsCollection = client.db("rewatch").collection("products");
    const bookingsCollection = client.db("rewatch").collection("bookings");
    const paymentsCollection = client.db("rewatch").collection("payments");

    // Verify Admin
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded?.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);

      if (user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // Verify Seller
    const verifySeller = async (req, res, next) => {
      const decodedEmail = req.decoded?.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "seller") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // Verify Buyer
    const verifyBuyer = async (req, res, next) => {
      const decodedEmail = req.decoded?.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);

      if (user?.role !== "buyer") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // Send User Role
    app.get("/users/userRole/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role });
    });

    //   Get Categories
    app.get("/categories", async (req, res) => {
      const query = {};
      const categories = await categoriesCollection.find(query).toArray();
      res.send(categories);
    });

    // Get Products by Category Id
    app.get("/categories/:id", async (req, res) => {
      const id = req.params.id;
      const query = {
        categoryID: ObjectId(id),
        // status: {
        //   $ne: "sold",
        // },
      };
      const products = await productsCollection.find(query).toArray();
      res.send(products);
    });

    // Get Products by User
    app.get("/products", verifyJWT, verifySeller, async (req, res) => {
      const email = req.query.email;

      const query = {
        sellerEmail: email,
      };
      const sellerProducts = await productsCollection.find(query).toArray();

      res.send(sellerProducts);
    });

    // Get Promoted Products
    app.get("/products/promoted", async (req, res) => {
      const promoted = req.query.promoted;

      const promotedQuery = {
        promoted: Boolean(promoted),
        status: "available",
      };

      const promotedProducts = await productsCollection
        .find(promotedQuery)
        .sort({ promoteTime: -1 })
        .toArray();

      res.send(promotedProducts);
    });

    // Add Product
    app.post("/products", async (req, res) => {
      const product = req.body;
      const categories = await categoriesCollection.find({}).toArray();
      categories.forEach((category) => {
        if (category.categoryName === product.categoryName) {
          product.categoryID = category._id;
        }
      });

      const query = {
        role: "seller",
      };

      const sellers = await usersCollection.find(query).toArray();

      sellers.forEach((seller) => {
        if (seller.email === product.sellerEmail) {
          product.sellerId = seller._id;
          product.isSellerVerified = seller.isVerified;
        }
      });

      const result = await productsCollection.insertOne(product);
      res.send(result);
    });

    // Delete Product
    app.delete("/products", async (req, res) => {
      const id = req.query.id;
      const query = { _id: ObjectId(id) };
      const result = await productsCollection.deleteOne(query);
      res.send(result);
    });

    // Add user
    app.post("/users", async (req, res) => {
      const user = req.body;
      const users = await usersCollection
        .find()
        .project({ email: 1 })
        .toArray();

      const userEmails = users.map((user) => user.email);

      if (userEmails.includes(user.email)) {
        return res.send({ message: `Welcome Back ${user.name}` });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // Verify Seller
    app.patch("/verify", async (req, res) => {
      const id = req.query.id;

      const filter = { _id: ObjectId(id) };
      const updatedDoc = { $set: { isVerified: true } };
      const options = { upsert: true };
      const result = await usersCollection.updateOne(
        filter,
        updatedDoc,
        options
      );

      const productFilter = {
        sellerId: ObjectId(id),
      };
      const productUpdatedDoc = { $set: { isSellerVerified: true } };
      const updateResult = await productsCollection.updateMany(
        productFilter,
        productUpdatedDoc,
        options
      );

      res.send({ result, updateResult });
    });

    // Delete User
    app.delete("/users", async (req, res) => {
      const id = req.query.id;

      const role = req.query.role;
      const query = { _id: ObjectId(id) };

      const result = await usersCollection.deleteOne(query);

      let deleteResult;
      if (role === "seller") {
        const productFilter = {
          sellerId: ObjectId(id),
        };

        deleteResult = await productsCollection.deleteMany(productFilter);
      }

      if (role === "buyer") {
        const bookingFilter = {
          buyerId: ObjectId(id),
        };
        deleteResult = await bookingsCollection.deleteMany(bookingFilter);
      }

      res.send({ result, deleteResult });
    });

    // Promote Product
    app.patch(
      "/products/promote",
      verifyJWT,
      verifySeller,
      async (req, res) => {
        const id = req.query.id;
        const filter = { _id: ObjectId(id) };
        const updatedDoc = {
          $set: { promoted: true, promoteTime: new Date().getTime() },
        };
        const options = { upsert: true };
        const result = await productsCollection.updateOne(
          filter,
          updatedDoc,
          options
        );
        res.send(result);
      }
    );

    // Stripe Payment Processing
    app.post("/create-payment-intent", async (req, res) => {
      const booking = req.body;
      const price = parseInt(booking.price.slice(1));
      const amount = price * 100;

      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // Add Payment
    app.post("/payment", async (req, res) => {
      // Insert Payment to Collection
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);

      const id = payment.bookingId;
      const filter = {
        _id: ObjectId(id),
      };

      // Updated booking status
      const bookingUpdatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };
      const options = {
        upsert: true,
      };

      const bookingUpdate = await bookingsCollection.updateOne(
        filter,
        bookingUpdatedDoc,
        options
      );

      // Update Product Status
      const filterProduct = {
        _id: ObjectId(payment.productId),
      };
      const productUpdatedDoc = {
        $set: {
          status: "sold",
        },
      };
      const updateResult = await productsCollection.updateOne(
        filterProduct,
        productUpdatedDoc,
        options
      );

      res.send(result);
    });

    // Issue JWT Token
    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN_SECRET, {
          expiresIn: "10d",
        });
        return res.send({ accessToken: token });
      }
      return res.status(403).send({ accessToken: "" });
    });

    // Get User By Role
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;

      if (email !== decodedEmail) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const role = req.query.role;
      const query = {
        role: role,
      };
      const usersByRole = await usersCollection.find(query).toArray();
      res.send(usersByRole);
    });

    // Add Booking
    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const filter = {
        _id: ObjectId(booking.productId),
      };
      const updatedDoc = {
        $set: {
          status: "booked",
        },
      };
      const options = { upsert: true };
      const updateResult = await productsCollection.updateOne(
        filter,
        updatedDoc,
        options
      );

      const query = {
        role: "buyer",
      };

      const buyers = await usersCollection.find(query).toArray();

      buyers.forEach((buyer) => {
        if (buyer.email === booking.buyerEmail) {
          booking.buyerId = buyer._id;
        }
      });

      const result = await bookingsCollection.insertOne(booking);

      res.send({ updateResult, result });
    });

    // Get Booking
    app.get("/bookings", verifyJWT, verifyBuyer, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;

      if (email !== decodedEmail) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = {
        buyerEmail: email,
      };
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });

    // Get Booking by Id
    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = {
        _id: ObjectId(id),
      };
      const booking = await bookingsCollection.findOne(query);
      res.send(booking);
    });

    // Delete Booking
    app.delete("/bookings", async (req, res) => {
      const id = req.query.id;
      const productId = req.query.productId;

      const query = {
        _id: ObjectId(id),
      };
      const bookingDelete = await bookingsCollection.deleteOne(query);

      const productFilter = {
        _id: ObjectId(productId),
      };
      const updatedDoc = { $set: { status: "available" } };
      const options = { upsert: true };

      const updateResult = await productsCollection.updateOne(
        productFilter,
        updatedDoc,
        options
      );

      res.send({ bookingDelete, updateResult });
    });

    // Add to Wishlist
    app.post("/users/wishlist", async (req, res) => {
      const email = req.query.email;
      const wishlistItem = req.body;
      const filter = {
        email: email,
      };
      const updatedDoc = {
        $push: {
          wishlist: wishlistItem,
        },
      };
      const options = {
        upsert: true,
      };

      const userUpdate = await usersCollection.updateOne(
        filter,
        updatedDoc,
        options
      );

      const productFilter = {
        _id: ObjectId(wishlistItem._id),
      };

      const productUpdatedDoc = {
        $push: {
          userWishlisted: email,
        },
      };

      const productUpdate = await productsCollection.updateOne(
        productFilter,
        productUpdatedDoc,
        options
      );

      res.send({ userUpdate, productUpdate });
    });

    // Remove from Wishlist
    app.delete("/users/wishlist", async (req, res) => {
      const email = req.query.email;
      const wishlistItem = req.body;

      const filter = {
        email: email,
      };
      const updatedDoc = {
        $pull: {
          wishlist: {
            _id: wishlistItem._id,
          },
        },
      };
      const options = {
        upsert: false,
      };

      const userUpdate = await usersCollection.updateMany(
        filter,
        updatedDoc,
        options
      );

      const productFilter = {
        _id: ObjectId(wishlistItem._id),
      };

      const productUpdatedDoc = {
        $pull: {
          userWishlisted: email,
        },
      };

      const productUpdate = await productsCollection.updateOne(
        productFilter,
        productUpdatedDoc,
        options
      );

      res.send({ userUpdate, productUpdate });
    });

    // Get Wishlist Items
    app.get("/products/wishlist", async (req, res) => {
      const email = req.query.email;

      const query = {
        userWishlisted: email,
      };
      const wishlist = await productsCollection.find(query).toArray();

      res.send(wishlist);
    });
  } finally {
  }
}

run().catch((err) => console.log(err));

app.listen(port, console.log(`Rewatch Server is Running on Port ${port}`));
