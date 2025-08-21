const { mongoose } = require("mongoose");

const QuerySchema = new mongoose.Schema({
  question: String,
  response: Array,
  summary: String,
  date: { type: Date, default: Date.now },
});
module.exports = mongoose.model('QueryLog', QuerySchema);