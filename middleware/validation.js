const { body, validationResult } = require('express-validator');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// User registration validation
const validateUserRegistration = [
  body('name')
    .isLength({ min: 3, max: 60 })
    .withMessage('Name must be between 3 and 60 characters')
    .trim()
    .escape(),
  
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail()
    .toLowerCase(),
  
  body('password')
    .isLength({ min: 8, max: 16 })
    .withMessage('Password must be between 8 and 16 characters')
    .matches(/^(?=.*[A-Z])(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/)
    .withMessage('Password must contain at least one uppercase letter and one special character'),
  
  body('address')
    .isLength({ max: 400 })
    .withMessage('Address must not exceed 400 characters')
    .notEmpty()
    .withMessage('Address is required')
    .trim()
    .escape(),
  
  handleValidationErrors
];

// User login validation
const validateUserLogin = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail()
    .toLowerCase(),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  
  handleValidationErrors
];

// Store creation validation
const validateStoreCreation = [
  body('name')
    .isLength({ min: 20, max: 60 })
    .withMessage('Store name must be between 20 and 60 characters')
    .trim()
    .escape(),
  
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail()
    .toLowerCase(),
  
  body('address')
    .isLength({ max: 400 })
    .withMessage('Address must not exceed 400 characters')
    .notEmpty()
    .withMessage('Address is required')
    .trim()
    .escape(),
  
  body('ownerId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Owner ID must be a positive integer'),
  
  handleValidationErrors
];

// Rating submission validation
const validateRating = [
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  
  body('storeId')
    .isInt({ min: 1 })
    .withMessage('Store ID must be a positive integer'),
  
  handleValidationErrors
];

// Password update validation
const validatePasswordUpdate = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  
  body('newPassword')
    .isLength({ min: 8, max: 16 })
    .withMessage('New password must be between 8 and 16 characters')
    .matches(/^(?=.*[A-Z])(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/)
    .withMessage('New password must contain at least one uppercase letter and one special character'),
  
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Password confirmation does not match new password');
      }
      return true;
    }),
  
  handleValidationErrors
];

// User update validation (for admin)
const validateUserUpdate = [
  body('name')
    .optional()
    .isLength({ min: 3, max: 60 })
    .withMessage('Name must be between 3 and 60 characters')
    .trim()
    .escape(),
  
  body('email')
    .optional()
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail()
    .toLowerCase(),
  
  body('address')
    .optional()
    .isLength({ max: 400 })
    .withMessage('Address must not exceed 400 characters')
    .trim()
    .escape(),
  
  body('role')
    .optional()
    .isIn(['system_admin', 'normal_user', 'store_owner'])
    .withMessage('Role must be one of: system_admin, normal_user, store_owner'),
  
  handleValidationErrors
];

// Store update validation
const validateStoreUpdate = [
  body('name')
    .optional()
    .isLength({ min: 20, max: 60 })
    .withMessage('Store name must be between 20 and 60 characters')
    .trim()
    .escape(),
  
  body('email')
    .optional()
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail()
    .toLowerCase(),
  
  body('address')
    .optional()
    .isLength({ max: 400 })
    .withMessage('Address must not exceed 400 characters')
    .trim()
    .escape(),
  
  handleValidationErrors
];

// Search validation
const validateSearch = [
  body('searchTerm')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Search term must not exceed 100 characters')
    .trim()
    .escape(),
  
  body('searchBy')
    .optional()
    .isIn(['name', 'email', 'address', 'role'])
    .withMessage('Search field must be one of: name, email, address, role'),
  
  handleValidationErrors
];

module.exports = {
  validateUserRegistration,
  validateUserLogin,
  validateStoreCreation,
  validateRating,
  validatePasswordUpdate,
  validateUserUpdate,
  validateStoreUpdate,
  validateSearch,
  handleValidationErrors
};