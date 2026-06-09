// Worker entry point — every request to lisaany.com hits this file.
//
// Routing logic:
//   /api/create-checkout  -> create-checkout.js
//   /api/book-checkout    -> book-checkout.js   (one-time tutoring payments)
//   /api/billing-portal   -> billing-portal.js
//   /api/webhook          -> webhook.js
//   /api/class-roster     -> school.js          (names a kid sees after the class QR)
//   /api/kid-signin       -> school.js          (tap a name -> sign that kid's hidden account in)
//   /api/add-student      -> school.js          (staff/admin adds a kid to a class)
//   everything else       -> static HTML files (via the ASSETS binding)

import { handleCreateCheckout } from './create-checkout.js';
import { handleBookCheckout } from './book-checkout.js';
import { handleBillingPortal } from './billing-portal.js';
import { handleWebhook } from './webhook.js';
import { handleClassRoster, handleKidSignin, handleAddStudent, handleCreateClass, handleListSchools, handleDeleteSchool, handleRemoveStudent, handleClaimClass, handleMyClass } from './school.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API routes
    if (url.pathname === '/api/create-checkout') {
      return handleCreateCheckout(request, env);
    }
    if (url.pathname === '/api/book-checkout') {
      return handleBookCheckout(request, env);
    }
    if (url.pathname === '/api/billing-portal') {
      return handleBillingPortal(request, env);
    }
    if (url.pathname === '/api/webhook') {
      return handleWebhook(request, env);
    }
    if (url.pathname === '/api/class-roster') {
      return handleClassRoster(request, env);
    }
    if (url.pathname === '/api/kid-signin') {
      return handleKidSignin(request, env);
    }
    if (url.pathname === '/api/add-student') {
      return handleAddStudent(request, env);
    }
    if (url.pathname === '/api/create-class') {
      return handleCreateClass(request, env);
    }
    if (url.pathname === '/api/list-schools') {
      return handleListSchools(request, env);
    }
    if (url.pathname === '/api/delete-school') {
      return handleDeleteSchool(request, env);
    }
    if (url.pathname === '/api/remove-student') {
      return handleRemoveStudent(request, env);
    }
    if (url.pathname === '/api/claim-class') {
      return handleClaimClass(request, env);
    }
    if (url.pathname === '/api/my-class') {
      return handleMyClass(request, env);
    }

    // Everything else: serve the static HTML files
    return env.ASSETS.fetch(request);
  },
};
