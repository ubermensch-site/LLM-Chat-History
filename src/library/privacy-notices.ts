const deleteButton = document.getElementById('delete-chat');
const actionBlock = document.querySelector<HTMLElement>('.action-block');

if (deleteButton) {
  deleteButton.title =
    'Deletes this conversation from the LLM Chat History browser archive only. It does not delete the provider chat or previously written computer-folder mirror files.';
  deleteButton.setAttribute(
    'aria-description',
    'Deletes the browser archive copy only. The provider conversation and existing filesystem mirror files are unchanged.'
  );
}

if (actionBlock) {
  const style = document.createElement('style');
  style.textContent = `
    .privacy-delete-note {
      margin: 0;
      max-width: 680px;
      font-size: 10px;
      line-height: 1.35;
      color: var(--on-surface-variant);
      text-align: right;
    }
    @media (max-width: 900px) {
      .privacy-delete-note { text-align: left; }
    }
  `;
  document.head.append(style);

  const notice = document.createElement('p');
  notice.className = 'privacy-delete-note';
  notice.textContent =
    'Delete affects the browser archive copy only. It does not delete the original provider chat or Markdown files already written to a connected computer folder.';
  actionBlock.append(notice);
}
