const deleteButton = document.getElementById('delete-chat');

if (deleteButton) {
  deleteButton.title =
    'Deletes this conversation from the LLM Chat History browser archive only. It does not delete the provider chat or previously written computer-folder mirror files.';
  deleteButton.setAttribute(
    'aria-description',
    'Deletes the browser archive copy only. The provider conversation and existing filesystem mirror files are unchanged.'
  );
}
