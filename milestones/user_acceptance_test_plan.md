# User Acceptance Test Plan

## Project
ModelScope

## Test Environment
- Primary environment: `localhost`
- Frontend URL: `http://localhost:5173`
- Backend URL: `http://localhost:5001`
- Intended run method: `docker compose up --build` or local workspace scripts after installing dependencies
- Actual execution environment used for observations on April 8, 2026: local machine in the project workspace

## User Acceptance Testers
- Charlie Copp, primary acceptance tester
- Wallis McGuire, secondary acceptance tester

## Test Data
- API health test data: no input payload is required
- Feature list test data: no input payload is required
- Home page rendering test data: default application state with no user-submitted dataset loaded
- Expected feature records returned by the backend:
  - `Upload CSV datasets`
  - `Generate automatic data models`
  - `Organize saved modeling projects`

## Feature 1: API Health Check

### Goal
Verify that the backend service is reachable and returns the expected health response.

### User Activity
1. Start the backend service locally.
2. Open a browser or API client.
3. Send a `GET` request to `http://localhost:5001/api/health`.

### Test Case
- Test case ID: UAT-01
- Input data: no request body
- Expected result:
  - HTTP status is `200`
  - Response body contains:
    - `status: "ok"`
    - `service: "modelscope-api"`
    - `message: "Express server is running."`

### Actual Test Results
- Observed on April 8, 2026:
  - Backend start command executed: `npm run start --workspace server`
  - Actual result: failed before the route could be tested
  - Error observed: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'cors'`
  - Acceptance outcome: failed in current local environment because required dependencies are not installed

## Feature 2: Feature List API

### Goal
Verify that the backend returns the expected list of starter features for the frontend.

### User Activity
1. Start the backend service locally.
2. Open a browser or API client.
3. Send a `GET` request to `http://localhost:5001/api/features`.

### Test Case
- Test case ID: UAT-02
- Input data: no request body
- Expected result:
  - HTTP status is `200`
  - Response body is an array with exactly these values:
    - `Upload CSV datasets`
    - `Generate automatic data models`
    - `Organize saved modeling projects`

### Actual Test Results
- Observed on April 8, 2026:
  - The route definition exists in the backend source and is configured to return the expected three strings
  - Live execution could not be completed because the backend would not start without installed dependencies
  - Acceptance outcome: blocked in current local environment; code inspection indicates the expected response after dependencies are installed

## Feature 3: Home Page Status and Feature Rendering

### Goal
Verify that the React homepage loads, requests backend data, shows the API status message, and renders the feature list for the user.

### User Activity
1. Start both frontend and backend services locally.
2. Open `http://localhost:5173` in a browser.
3. Observe the navigation bar, hero section, API status card, and starter feature list.

### Test Case
- Test case ID: UAT-03
- Input data:
  - Browser navigation to the home page
  - Backend responses from `/api/health` and `/api/features`
- Expected result:
  - The page displays the title `ModelScope`
  - The API status card shows `Express server is running.`
  - The page renders a list containing all three starter features
  - The navigation bar includes `Home`, `Projects`, and `Upload`

### Actual Test Results
- Observed on April 8, 2026:
  - Frontend build command executed: `npm run build`
  - Actual result: failed before browser-based verification
  - Error observed: `sh: vite: command not found`
  - Acceptance outcome: failed in current local environment because frontend dependencies are not installed

## Summary of Acceptance Results
- UAT-01 API Health Check: failed in the current localhost environment due to missing backend dependencies
- UAT-02 Feature List API: blocked by the same backend dependency issue; expected result confirmed by source review
- UAT-03 Home Page Status and Feature Rendering: failed in the current localhost environment due to missing frontend dependencies

## Notes
- To complete final acceptance testing successfully, install workspace dependencies with `npm install --workspaces` or run the stack with Docker if Docker is configured with the needed packages.
- After dependencies are installed, the same test cases should be re-run and this document should be updated with pass/fail observations from live execution.
