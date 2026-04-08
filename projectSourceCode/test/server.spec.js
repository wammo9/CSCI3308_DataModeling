
// ********************** Initialize server **********************************

// const server = require('../../server/src/index.js'); //TODO: Make sure the path to your index.js is correctly added
const server = require('../index.js').default; //TODO: Make sure the path to your index.js is correctly added

// ********************** Import Libraries ***********************************

const chai = require('chai'); // Chai HTTP provides an interface for live integration testing of the API's.
const chaiHttp = require('chai-http');
chai.should();
chai.use(chaiHttp);
const {assert, expect} = chai;

// ********************** DEFAULT WELCOME TESTCASE ****************************

describe('Server!', () => {
  // Sample test case given to test / endpoint.
  it('Returns the default welcome message', done => {
    chai
      .request(server)
      .get('/welcome')
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body.status).to.equals('success');
        assert.strictEqual(res.body.message, 'Welcome!');
        done();
      });
  });
});

// *********************** TODO: WRITE 2 UNIT TESTCASES **************************
describe('Testing Register API', () => {
  
  // i. Positive Test Case
  // API: /register
  // Input: {username: 'testuser', password: 'password123'}
  // Expect: res.status == 200 and res.body.message == 'Success'
  it('positive : /register. Should successfully register a user', done => {
    chai
      .request(server)
      .post('/register')
      .send({ username: 'testuser', password: 'password123' })
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body.message).to.equals('Success');
        done();
      });
  });

  // ii. Negative Test Case
  // API: /register
  // Input: {username: 12345} (Invalid because username should be a string/provided)
  // Expect: res.status == 400 and res.body.message == 'Invalid input'
  it('negative : /register. Should fail when password is missing', done => {
    chai
      .request(server)
      .post('/register')
      .send({ username: 12345 }) // Missing password and invalid username type
      .end((err, res) => {
        expect(res).to.have.status(400);
        expect(res.body.message).to.equals('Invalid input');
        done();
      });
  });

});
// ********************************************************************************
// *********************** REDIRECT TESTCASE ****************************

describe('Testing Redirect', () => {
  it('/test route should redirect to /login with 302 HTTP status code', done => {
    chai
      .request(server)
      .get('/test')
      .redirects(0)
      .end((err, res) => {
        res.should.have.status(302); // Expecting redirect status
        // Using a more flexible Regex to handle Docker/Localhost differences
        res.should.redirectTo(/\/login$/); 
        done();
      });
  });
});

// *********************** RENDER TESTCASE ******************************

describe('Testing Render', () => {
  it('test "/login" route should render with an html response', done => {
    chai
      .request(server)
      .get('/login')
      .end((err, res) => {
        res.should.have.status(200); // Expecting success
        res.should.be.html;          // Expecting HTML content-type
        done();
      });
  });
});