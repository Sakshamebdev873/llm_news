const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();
const newsRouter = require('./routes/newsRoutes')


const app = express();
app.use(bodyParser.json());
app.use(cors());

app.use('/api/v1',newsRouter)
const PORT = process.env.PORT || 5100;

const start = async () => {
  try {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/v1/health`);
      console.log(
        `Debug endpoint: http://localhost:${PORT}/api/v1/debug/collection`
      );
    });
   try {
     await mongoose.connect(process.env.MONGODB_URI)
     console.log(`Connected to database....`);
     
   } catch (error) {
    console.log(error);
    
   }
  } catch (error) {
  console.error(error)
  }
};
start()
