const axios = require('axios')

async function getCustomerData(phone) {
  // try to match up the phone number with a user's info
  const customerData = {}
  // try Context Service first
  const params = {
    q: phone,
    field: 'query_string',
    token: process.env.CS_TOKEN_GET_CUSTOMER
  }
  const customers = await axios.get(`https://cxdemo.net/labconfig/api/demo/cs/customer`, {params})
  console.log(`Sparky - Context Service  - getContextCustomerData - found ${customers.data.length} matching customer(s) in Context Service`)
  if (!customers.data.length) {
    throw `no Context Service customers found matching ${phone}`
  }
  // get customer ID from Context Service
  console.log('Sparky - Context Service - getCustomerData - chose first Context Service customer -', customers.data[0].customerId)
  const customer = customers.data[0]
  // get customer data
  customerData.firstName = customer.Context_First_Name
  customerData.lastName = customer.Context_Last_Name
  customerData.email = customer.Context_Work_Email
  return customerData
}

module.exports = {
  getCustomerData
}
