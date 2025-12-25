const buttonSelectors = [
  // Existing selectors
  { selector: 'button.ce-btn.ce-blue:has-text("Verify")', label: 'Verify', force: 'conditional_not_arolinks' },
  { selector: 'button:has-text("Continue")', label: 'Continue', force: 'conditional_not_arolinks' },
  { selector: 'button#cross-snp2.ce-btn.ce-blue', label: 'Force Continue', force: 'conditional_not_arolinks' },
  { selector: 'button#btn6.btn-hover.color-9:has-text("Continue")', label: 'Continue btn6 color-9', force: 'conditional_not_arolinks' },
  { selector: 'button#btn6.btn-hover.color-11:has-text("Continue Next")', label: 'Continue Next', force: 'conditional_not_arolinks' },
  { selector: 'button[onclick="scrol()"]:has-text("Verify Link")', label: 'Verify Link onclick', force: true },
  { selector: 'button:has-text("Go Next")', label: 'Go Next', force: 'conditional_not_arolinks' },
  { selector: 'button#btn6.btn-hover.color-11:has-text("Get Link")', label: 'Get Link btn6 color-11', force: false },
  // New GPLinks selectors
  { selector: 'button#VerifyBtn.VerifyBtn:has-text("VERIFY")', label: 'Verify GPLinks', force: false },
  { selector: 'a#NextBtn.NextBtn.exclude-pop:has-text("CONTINUE")', label: 'Continue GPLinks', force: false },
  { selector: 'a#captchaButton.btn.btn-primary.rounded.get-link.xclude-popad:has-text("Get Link")', label: 'Get Link GPLinks', force: false },
  // New Adrinolinks selectors
  { selector: 'button#nextbtn.tp-btn-2.tp-blue.countdown[onclick*="nextscroll()"]:has-text("Continue")', label: 'Continue Adrino', force: false },
  { selector: 'button#tp-snp2.tp-btn-2.tp-blue:has-text("Click here to proceed")', label: 'Click here to proceed Adrino', force: false },
];

module.exports = buttonSelectors;